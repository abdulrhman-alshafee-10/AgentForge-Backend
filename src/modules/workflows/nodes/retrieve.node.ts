import { ragService } from '../../rag/rag.service.js';
import { eventsService } from '../../executions/events.service.js';
import { logger } from '../../../common/logger/logger.js';
import type { AgentState } from '../workflow.types.js';

// ─── Retrieve node ────────────────────────────────────────────────────────────
//
// Calls the RAG service to fetch the top-K most relevant document chunks.
// Results are stored in state so the reason node can use them as context.
//
// Emits: RETRIEVING_DOCUMENTS event

export async function retrieveNode(state: AgentState): Promise<Partial<AgentState>> {
  const { tenantId, executionId, chatId, input } = state;

  await eventsService.appendEvent(tenantId, chatId, executionId, 'RETRIEVING_DOCUMENTS', {
    query: input,
  });

  try {
    const results = await ragService.retrieveContext({
      tenantId,
      query: input,
      k: 4,
    });

    const retrievedChunks = results.map((r) => ({
      id: r.id,
      content: r.content,
      documentId: r.documentId,
      distance: r.distance,
    }));

    logger.debug({ executionId, chunks: retrievedChunks.length }, 'retrieve node complete');

    return { retrievedChunks };
  } catch (err: any) {
    // Retrieval failure is non-fatal — the agent continues without context
    logger.warn({ err, executionId }, 'retrieve node failed — continuing without context');
    return { retrievedChunks: [] };
  }
}
