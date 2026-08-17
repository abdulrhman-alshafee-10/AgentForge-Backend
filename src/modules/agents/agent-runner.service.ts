import { prisma } from '../../db/prisma.js';
import { eventsService } from '../executions/events.service.js';
import { cancellationService } from '../executions/cancellation.service.js';
import { buildResearchV1Graph } from '../workflows/research-v1.graph.js';
import { createInitialState } from '../workflows/workflow.types.js';
import { MessageRole, ExecutionStatus } from '@prisma/client';
import { logger } from '../../common/logger/logger.js';

// ─── Sentinel error for clean cancellation ────────────────────────────────────
//
// Thrown when a cancel flag is detected.  The BullMQ worker catches this
// specific type and marks the job as non-retryable so it is moved straight
// to the failed set (not retried — the execution was intentionally stopped).

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
    // ── 1. Load execution + agent + input message ──────────────────────────
    const execution = await prisma.execution.findUnique({
      where: { id: executionId },
      include: { agent: true, inputMessage: true },
    });

    if (!execution) {
      logger.error({ executionId }, 'AgentRunner: execution not found');
      return;
    }

    // Idempotency: if another worker already picked this up, skip.
    if (execution.status !== ExecutionStatus.CREATED) {
      logger.warn(
        { executionId, status: execution.status },
        'AgentRunner: execution already processed — skipping',
      );
      return;
    }

    const { tenantId, chatId, userId, agentId, agent, inputMessage } = execution;
    const input = inputMessage.content;

    // ── 2. Pre-flight cancel check ─────────────────────────────────────────
    if (await cancellationService.isCancelled(executionId)) {
      logger.info({ executionId }, 'AgentRunner: cancelled before start');
      await this.handleCancel(executionId, tenantId, chatId);
      return;
    }

    // ── 3. Mark RUNNING ────────────────────────────────────────────────────
    await prisma.execution.update({
      where: { id: executionId },
      data: { status: ExecutionStatus.RUNNING, startedAt: new Date() },
    });

    await eventsService.appendEvent(tenantId, chatId, executionId, 'STARTED', {
      agentId,
      model: agent.model,
    });

    logger.info({ executionId, agentId, model: agent.model }, 'AgentRunner: starting');

    // ── 4. Run the graph ────────────────────────────────────────────────────
    try {
      const graph = buildResearchV1Graph();

      const initialState = createInitialState({
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

      // LangGraph doesn't have native cancel support, so we wrap invoke in a
      // cancellation race.  Between-node checks happen inside the nodes
      // themselves via cancellationService.isCancelled().
      const cancelRace = new Promise<never>((_, reject) => {
        const interval = setInterval(async () => {
          if (await cancellationService.isCancelled(executionId)) {
            clearInterval(interval);
            reject(new ExecutionCancelledError(executionId));
          }
        }, 1_000); // poll every second
        // Store interval ref on the promise so we can cancel it on completion
        (cancelRace as any).__interval = interval;
      });

      let finalState: typeof initialState;
      try {
        finalState = await Promise.race([
          graph.invoke(initialState as any).then((s) => s as typeof initialState),
          cancelRace,
        ]);
      } finally {
        // Always clear the polling interval
        const interval = (cancelRace as any).__interval;
        if (interval) clearInterval(interval);
      }

      if (finalState.error) {
        throw new Error(finalState.error);
      }

      const responseText = finalState.response ?? '(no response)';

      // ── 5. Persist assistant message ─────────────────────────────────────
      const outputMessage = await prisma.message.create({
        data: {
          tenantId,
          chatId,
          executionId,
          role: MessageRole.assistant,
          content: responseText,
          metadata: {
            model: agent.model,
            loopCount: finalState.loopCount,
            toolsUsed: finalState.toolResults.map((t) => t.toolName),
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
        loopCount: finalState.loopCount,
        toolsUsed: finalState.toolResults.length,
      });

      await cancellationService.clearCancel(executionId);
      logger.info({ executionId, loopCount: finalState.loopCount }, 'AgentRunner: completed');
    } catch (err: any) {
      if (err instanceof ExecutionCancelledError) {
        await this.handleCancel(executionId, tenantId, chatId);
        throw err; // re-throw so BullMQ marks the job non-retryable
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

      throw err; // re-throw so BullMQ retries
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
