import { embeddingsProvider } from '../vector-store/embeddings.provider.js';
import { vectorStoreService, type SimilaritySearchResult } from '../vector-store/vector-store.service.js';
import { logger } from '../../common/logger/logger.js';

export class RagService {
  /**
   * Retrieves relevant context for a given query, scoped to the tenant.
   * Orchestrates query embedding and vector similarity search.
   */
  async retrieveContext(
    tenantId: string,
    query: string,
    k: number = 4,
  ): Promise<SimilaritySearchResult[]> {
    logger.info({ tenantId, query, k }, 'Retrieving context for query');

    // 1. Embed the user's query
    const queryVector = await embeddingsProvider.embedQuery(query);

    // 2. Perform similarity search in the vector store
    const results = await vectorStoreService.similaritySearch(tenantId, queryVector, k);

    logger.info({ tenantId, found: results.length }, 'Context retrieval complete');
    
    // Note: We could add an optional re-ranking step here using a cross-encoder

    return results;
  }
}

export const ragService = new RagService();
