import { memoryService } from '../../memory/memory.service.js';
import { eventsService } from '../../executions/events.service.js';
import { logger } from '../../../common/logger/logger.js';
import type { AgentState } from '../workflow.types.js';

// ─── Retrieve Memory node ─────────────────────────────────────────────────────
//
// Runs in parallel (conceptually) with retrieve — fetches the user's
// long-term memories most relevant to the current input.
// Results are stored in state so the reason and respond nodes can include
// them in the LLM context window.
//
// Failure is non-fatal: if memory retrieval fails the agent continues
// with whatever context it already has.
//
// Emits: RETRIEVING_MEMORIES event

export async function retrieveMemoryNode(state: AgentState): Promise<Partial<AgentState>> {
  const { tenantId, userId, executionId, chatId, input } = state;

  await eventsService.appendEvent(tenantId, chatId, executionId, 'RETRIEVING_MEMORIES', {
    query: input,
  });

  try {
    const results = await memoryService.search({
      tenantId,
      userId,
      query: input,
      k: 4,
    });

    const retrievedMemories = results.map((r) => ({
      id: r.id,
      kind: r.kind,
      content: r.content,
      distance: r.distance,
    }));

    logger.debug(
      { executionId, memories: retrievedMemories.length },
      'retrieve-memory node complete',
    );

    return { retrievedMemories };
  } catch (err: any) {
    logger.warn({ err, executionId }, 'retrieve-memory node failed — continuing without memories');
    return { retrievedMemories: [] };
  }
}
