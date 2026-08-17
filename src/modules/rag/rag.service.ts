import { embeddingsProvider } from '../vector-store/embeddings.provider.js';
import { vectorStoreService, type SimilaritySearchResult } from '../vector-store/vector-store.service.js';
import { logger } from '../../common/logger/logger.js';

export interface RetrieveContextOptions {
  tenantId: string;
  query: string;
  /** Number of chunks to return (default: 4) */
  k?: number;
  /** Optional: restrict retrieval to a specific document */
  documentId?: string;
}

export class RagService {
  /**
   * Retrieves the most relevant context chunks for a given query.
   *
   * Pipeline:
   *  1. Embed the query using the configured model.
   *  2. Run a cosine similarity search scoped to the tenant.
   *  3. Return results ordered by relevance (ascending distance).
   */
  async retrieveContext(options: RetrieveContextOptions): Promise<SimilaritySearchResult[]> {
    const { tenantId, query, k = 4, documentId } = options;

    logger.debug({ tenantId, k, documentId }, 'RAG: retrieving context');

    const queryVector = await embeddingsProvider.embedQuery(query);

    const results = await vectorStoreService.similaritySearch({
      tenantId,
      queryVector,
      k,
      ...(documentId !== undefined && { documentId }),
    });

    logger.debug({ tenantId, found: results.length }, 'RAG: context retrieval complete');

    return results;
  }
}

export const ragService = new RagService();
