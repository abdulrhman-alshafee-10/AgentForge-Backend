import { prisma } from '../../db/prisma.js';
import { eventsService } from '../executions/events.service.js';
import { cancellationService } from '../executions/cancellation.service.js';
import { checkpointService } from '../checkpoints/checkpoint.service.js';
import { summarizerService } from '../memory/summarizer.service.js';
import { buildResearchV1Graph } from '../workflows/research-v1.graph.js';
import { createInitialState } from '../workflows/workflow.types.js';
import { ApprovalRequiredError } from '../workflows/nodes/act.node.js';
import { MessageRole, ExecutionStatus } from '@prisma/client';
import { logger } from '../../common/logger/logger.js';
import type { AgentState } from '../workflows/workflow.types.js';

// ─── Sentinel error for clean cancellation ────────────────────────────────────

export class ExecutionCancelledError extends Error {
  readonly isNonRetryable = true;
  constructor(executionId: string) {
    super(`Execution ${executionId} was cancelled`);
    this.name = 'ExecutionCancelledError';
  }
}

// ─── Agent Runner Service ──────────────────────────────────────────────────────

export class AgentRunnerService {
  async run(executionId: string): Promise<void> {
    // ── 1. Load execution ──────────────────────────────────────────────────
    const execution = await prisma.execution.findUnique({
      where: { id: executionId },
      include: { agent: true, inputMessage: true },
    });

    if (!execution) {
      logger.error({ executionId }, 'AgentRunner: execution not found');
      return;
    }

    const { tenantId, chatId, userId, agentId, agent, inputMessage } = execution;

    // ── 2. Check if already processed ─────────────────────────────────────
    // Allow RUNNING and WAITING_FOR_APPROVAL — both can be resumed.
    const isResumable = ['CREATED', 'RUNNING', 'WAITING_FOR_APPROVAL'].includes(execution.status);
    if (!isResumable) {
      logger.warn(
        { executionId, status: execution.status },
        'AgentRunner: execution is terminal — skipping',
      );
      return;
    }

    // ── 3. Pre-flight cancel check ─────────────────────────────────────────
    if (await cancellationService.isCancelled(executionId)) {
      logger.info({ executionId }, 'AgentRunner: cancelled before start');
      await this.handleCancel(executionId, tenantId, chatId);
      return;
    }

    // ── 4. Mark RUNNING (idempotent update) ───────────────────────────────
    await prisma.execution.update({
      where: { id: executionId },
      data: { status: ExecutionStatus.RUNNING, startedAt: new Date() },
    });

    // ── 5. Load latest checkpoint or build fresh state ────────────────────
    const input = inputMessage.content;
    let initialState: AgentState;
    let resumeFromNode: string | null = null;
    let parentCheckpointId: string | undefined;

    const saved = await checkpointService.loadLatest(executionId);

    if (saved) {
      // Resume: reuse checkpointed state, skip to the node after the last one saved
      initialState = saved.state;
      resumeFromNode = saved.checkpoint.nodeName;
      parentCheckpointId = saved.checkpoint.id;
      logger.info(
        { executionId, resumeFromNode },
        'AgentRunner: resuming from checkpoint',
      );

      await eventsService.appendEvent(tenantId, chatId, executionId, 'RESUMED', {
        fromNode: resumeFromNode,
        checkpointId: saved.checkpoint.id,
      });
    } else {
      // Fresh run
      initialState = createInitialState({
        input,
        tenantId,
        userId,
        executionId,
        chatId,
        agentId,
        systemPrompt: agent.systemPrompt || 'You are a helpful AI assistant.',
        model: agent.model,
        temperature: Number(agent.temperature),
      });

      await eventsService.appendEvent(tenantId, chatId, executionId, 'STARTED', {
        agentId,
        model: agent.model,
      });

      logger.info({ executionId, agentId, model: agent.model }, 'AgentRunner: starting fresh');
    }

    // ── 6. Run the graph with per-node checkpoint saves ────────────────────
    try {
      const graph = buildResearchV1Graph();

      // Use stream() to get per-node output so we can save checkpoints between nodes.
      // stream() yields objects of the shape { [nodeName]: partialState }
      const stream = await graph.stream(initialState as any, {
        streamMode: 'updates',
      });

      // Track the accumulated state as nodes complete
      let currentState: AgentState = { ...initialState };

      // Cancel polling
      let cancelled = false;
      const cancelPoll = setInterval(async () => {
        if (await cancellationService.isCancelled(executionId)) {
          cancelled = true;
        }
      }, 1_000);

      try {
        for await (const update of stream) {
          // Cancel check between nodes
          if (cancelled) {
            throw new ExecutionCancelledError(executionId);
          }

          // `update` is { nodeName: partialState }
          const [nodeName, nodeOutput] = Object.entries(update)[0] as [string, Partial<AgentState>];

          // Merge output into current state
          currentState = { ...currentState, ...nodeOutput };

          // Save checkpoint after this node
          const cp = await checkpointService.save(
            tenantId,
            executionId,
            nodeName,
            currentState,
            parentCheckpointId,
          );
          if (cp) parentCheckpointId = cp.id;

          logger.debug({ executionId, nodeName }, 'AgentRunner: node complete');
        }
      } finally {
        clearInterval(cancelPoll);
      }

      if (currentState.error) {
        throw new Error(currentState.error);
      }

      const responseText = currentState.response ?? '(no response)';

      // ── 7. Persist assistant message ─────────────────────────────────────
      const outputMessage = await prisma.message.create({
        data: {
          tenantId,
          chatId,
          executionId,
          role: MessageRole.assistant,
          content: responseText,
          metadata: {
            model: agent.model,
            loopCount: currentState.loopCount,
            toolsUsed: currentState.toolResults.map((t) => t.toolName),
          },
        },
      });

      await prisma.execution.update({
        where: { id: executionId },
        data: {
          status: ExecutionStatus.COMPLETED,
          outputMessageId: outputMessage.id,
          finishedAt: new Date(),
          workflowVersion: 'research-v1',
        },
      });

      await eventsService.appendEvent(tenantId, chatId, executionId, 'COMPLETED', {
        outputMessageId: outputMessage.id,
        loopCount: currentState.loopCount,
        toolsUsed: currentState.toolResults.length,
      });

      await cancellationService.clearCancel(executionId);

      // Auto-extract memories from the completed conversation (non-fatal)
      summarizerService.extractAndSave({
        executionId,
        tenantId,
        userId,
        chatId,
      }).catch((err) => {
        logger.warn({ err, executionId }, 'AgentRunner: memory extraction failed (non-fatal)');
      });

      // Prune intermediate checkpoints for this completed execution
      await checkpointService.prune(executionId).catch((err) => {
        logger.warn({ err, executionId }, 'AgentRunner: checkpoint pruning failed (non-fatal)');
      });

      logger.info({ executionId, loopCount: currentState.loopCount }, 'AgentRunner: completed');
    } catch (err: any) {
      if (err instanceof ExecutionCancelledError) {
        await this.handleCancel(executionId, tenantId, chatId);
        throw err;
      }

      // Approval pause: the act node needs human sign-off.
      // Save a checkpoint (already done by stream loop above the throw),
      // update execution status, and release the worker without retrying.
      if (err instanceof ApprovalRequiredError) {
        logger.info(
          { executionId, approvalId: err.approvalId },
          'AgentRunner: paused for approval — releasing worker',
        );
        // Status transition and event already done inside approvalService.createApproval().
        // BullMQ should NOT retry this — mark as non-retryable by re-throwing.
        throw err;
      }

      logger.error({ err, executionId }, 'AgentRunner: execution failed');

      await prisma.execution.update({
        where: { id: executionId },
        data: {
          status: ExecutionStatus.FAILED,
          finishedAt: new Date(),
          error: { message: err.message ?? 'Unknown error', stack: err.stack },
        },
      });

      await eventsService.appendEvent(tenantId, chatId, executionId, 'FAILED', {
        error: err.message ?? 'Unknown error',
      });

      throw err;
    }
  }

  private async handleCancel(
    executionId: string,
    tenantId: string,
    chatId: string,
  ): Promise<void> {
    await prisma.execution.update({
      where: { id: executionId },
      data: { status: ExecutionStatus.CANCELLED, finishedAt: new Date() },
    });

    await eventsService.appendEvent(tenantId, chatId, executionId, 'CANCELLED', {
      reason: 'Cancellation requested',
    });

    await cancellationService.clearCancel(executionId);
    logger.info({ executionId }, 'AgentRunner: execution cancelled');
  }
}

export const agentRunnerService = new AgentRunnerService();
