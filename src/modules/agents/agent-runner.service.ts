import { prisma } from '../../db/prisma.js';
import { eventsService } from '../executions/events.service.js';
import { buildResearchV1Graph } from '../workflows/research-v1.graph.js';
import { createInitialState } from '../workflows/workflow.types.js';
import { MessageRole, ExecutionStatus } from '@prisma/client';
import { logger } from '../../common/logger/logger.js';

// ─── Agent Runner Service ──────────────────────────────────────────────────────
//
// Orchestrates a single execution end-to-end:
//
//  1. Load the agent configuration and input message from Postgres.
//  2. Mark the execution RUNNING and emit STARTED.
//  3. Build and run the LangGraph workflow.
//  4. On success: persist the assistant Message, mark execution COMPLETED.
//  5. On failure: emit FAILED event, persist error, mark execution FAILED.
//
// Called fire-and-forget from MessagesService after the HTTP response is sent.
// Phase 09 will move this call into a BullMQ worker.

export class AgentRunnerService {
  async run(executionId: string): Promise<void> {
    // ── 1. Load execution + agent + input message ──────────────────────────
    const execution = await prisma.execution.findUnique({
      where: { id: executionId },
      include: {
        agent: true,
        inputMessage: true,
      },
    });

    if (!execution) {
      logger.error({ executionId }, 'AgentRunner: execution not found');
      return;
    }

    if (execution.status !== ExecutionStatus.CREATED) {
      logger.warn({ executionId, status: execution.status }, 'AgentRunner: execution already processed');
      return;
    }

    const { tenantId, chatId, userId, agentId, agent, inputMessage } = execution;
    const input = inputMessage.content;

    // ── 2. Mark RUNNING ────────────────────────────────────────────────────
    await prisma.execution.update({
      where: { id: executionId },
      data: { status: ExecutionStatus.RUNNING, startedAt: new Date() },
    });

    await eventsService.appendEvent(tenantId, chatId, executionId, 'STARTED', {
      agentId,
      model: agent.model,
    });

    logger.info({ executionId, agentId, model: agent.model }, 'AgentRunner: starting');

    // ── 3. Run the graph ────────────────────────────────────────────────────
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

      const finalState = await graph.invoke(initialState as any) as typeof initialState;

      // Check for graph-level error flag
      if (finalState.error) {
        throw new Error(finalState.error);
      }

      const responseText = finalState.response ?? '(no response)';

      // ── 4. Persist assistant message ─────────────────────────────────────
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

      // ── Link output message to execution ──────────────────────────────────
      await prisma.execution.update({
        where: { id: executionId },
        data: {
          status: ExecutionStatus.COMPLETED,
          outputMessageId: outputMessage.id,
          finishedAt: new Date(),
          workflowVersion: 'research-v1',
        },
      });

      // ── Emit terminal COMPLETED event ─────────────────────────────────────
      await eventsService.appendEvent(tenantId, chatId, executionId, 'COMPLETED', {
        outputMessageId: outputMessage.id,
        loopCount: finalState.loopCount,
        toolsUsed: finalState.toolResults.length,
      });

      logger.info({ executionId, loopCount: finalState.loopCount }, 'AgentRunner: completed');
    } catch (err: any) {
      // ── 5. Handle failure ─────────────────────────────────────────────────
      logger.error({ err, executionId }, 'AgentRunner: execution failed');

      const errorPayload = {
        message: err.message ?? 'Unknown error',
        stack: err.stack,
      };

      await prisma.execution.update({
        where: { id: executionId },
        data: {
          status: ExecutionStatus.FAILED,
          finishedAt: new Date(),
          error: errorPayload,
        },
      });

      await eventsService.appendEvent(tenantId, chatId, executionId, 'FAILED', {
        error: errorPayload.message,
      });
    }
  }
}

export const agentRunnerService = new AgentRunnerService();
