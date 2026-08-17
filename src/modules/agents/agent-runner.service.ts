// ─── Agent runner service ─────────────────────────────────────────────────────
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

export class ExecutionCancelledError extends Error {
  readonly isNonRetryable = true;
  constructor(executionId: string) {
    super(`Execution ${executionId} was cancelled`);
    this.name = 'ExecutionCancelledError';
  }
}

export class AgentRunnerService {
  async run(executionId: string): Promise<void> {
    const execution = await prisma.execution.findUnique({
      where: { id: executionId },
      include: { agent: true, inputMessage: true },
    });

    if (!execution) {
      logger.error({ executionId }, 'AgentRunner: execution not found');
      return;
    }

    const { tenantId, chatId, userId, agentId, agent, inputMessage } = execution;

    if (!inputMessage) {
      logger.error({ executionId }, 'AgentRunner: inputMessage is null — skipping');
      return;
    }

    const isResumable = ['CREATED', 'RUNNING', 'WAITING_FOR_APPROVAL'].includes(execution.status);
    if (!isResumable) {
      logger.warn({ executionId, status: execution.status }, 'AgentRunner: terminal — skipping');
      return;
    }

    if (await cancellationService.isCancelled(executionId, tenantId)) {
      await this.handleCancel(executionId, tenantId, chatId);
      return;
    }

    await prisma.execution.update({
      where: { id: executionId },
      data: { status: ExecutionStatus.RUNNING, startedAt: new Date() },
    });

    // ─── Load checkpoint or build fresh state ─────────────────────────────────

    let initialState: AgentState;
    let parentCheckpointId: string | undefined;

    const saved = await checkpointService.loadLatest(executionId);

    if (saved) {
      initialState = saved.state;
      parentCheckpointId = saved.checkpoint.id;
      logger.info({ executionId, fromNode: saved.checkpoint.nodeName }, 'AgentRunner: resuming');
      await eventsService.appendEvent(tenantId, chatId, executionId, 'RESUMED', {
        fromNode: saved.checkpoint.nodeName,
        checkpointId: saved.checkpoint.id,
      });
    } else {
      initialState = createInitialState({
        input: inputMessage.content,
        tenantId, userId, executionId, chatId, agentId,
        systemPrompt: agent.systemPrompt || 'You are a helpful AI assistant.',
        model: agent.model,
        temperature: Number(agent.temperature),
      });
      await eventsService.appendEvent(tenantId, chatId, executionId, 'STARTED', {
        agentId, model: agent.model,
      });
      logger.info({ executionId, agentId, model: agent.model }, 'AgentRunner: fresh start');
    }

    // ─── Run graph ────────────────────────────────────────────────────────────

    try {
      const graph = buildResearchV1Graph();
      const stream = await graph.stream(initialState as any, { streamMode: 'updates' });
      let currentState: AgentState = { ...initialState };
      let cancelled = false;

      const cancelPoll = setInterval(async () => {
        if (await cancellationService.isCancelled(executionId, tenantId)) cancelled = true;
      }, 1_000);

      try {
        for await (const update of stream) {
          if (cancelled) throw new ExecutionCancelledError(executionId);

          const [nodeName, nodeOutput] = Object.entries(update)[0] as [string, Partial<AgentState>];
          currentState = { ...currentState, ...nodeOutput };

          const cp = await checkpointService.save(tenantId, executionId, nodeName, currentState, parentCheckpointId);
          if (cp) parentCheckpointId = cp.id;
        }
      } finally {
        clearInterval(cancelPoll);
      }

      if (currentState.error) throw new Error(currentState.error);

      const responseText = currentState.response ?? '(no response)';

      const outputMessage = await prisma.message.create({
        data: {
          tenantId, chatId, executionId,
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

      await cancellationService.clearCancel(executionId, tenantId);

      summarizerService
        .extractAndSave({ executionId, tenantId, userId, chatId })
        .catch((err) => logger.warn({ err, executionId }, 'Memory extraction failed'));

      await checkpointService.prune(executionId).catch((err) => {
        logger.warn({ err, executionId }, 'Checkpoint pruning failed');
      });

      logger.info({ executionId, loopCount: currentState.loopCount }, 'AgentRunner: completed');
    } catch (err: any) {
      if (err instanceof ExecutionCancelledError) {
        await this.handleCancel(executionId, tenantId, chatId);
        throw err;
      }

      if (err instanceof ApprovalRequiredError) {
        logger.info({ executionId, approvalId: err.approvalId }, 'AgentRunner: paused for approval');
        throw err;
      }

      logger.error({ err, executionId }, 'AgentRunner: failed');

      await prisma.execution.update({
        where: { id: executionId },
        data: { status: ExecutionStatus.FAILED, finishedAt: new Date(), error: { message: err.message, stack: err.stack } },
      });

      await eventsService.appendEvent(tenantId, chatId, executionId, 'FAILED', { error: err.message });
      throw err;
    }
  }

  private async handleCancel(executionId: string, tenantId: string, chatId: string): Promise<void> {
    await prisma.execution.update({
      where: { id: executionId },
      data: { status: ExecutionStatus.CANCELLED, finishedAt: new Date() },
    });
    await eventsService.appendEvent(tenantId, chatId, executionId, 'CANCELLED', { reason: 'Cancellation requested' });
    await cancellationService.clearCancel(executionId, tenantId);
    logger.info({ executionId }, 'AgentRunner: cancelled');
  }
}

export const agentRunnerService = new AgentRunnerService();
