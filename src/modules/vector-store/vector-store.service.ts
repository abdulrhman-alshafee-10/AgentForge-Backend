import { prisma } from '../../db/prisma.js';

export interface SimilaritySearchResult {
  chunkIndex: number;
  content: string;
  metadata: any;
  distance: number;
}

export class VectorStoreService {
  /**
   * Performs a vector similarity search using pgvector `<->` operator.
   */
  async similaritySearch(
    tenantId: string,
    queryVector: number[],
    k: number = 4,
  ): Promise<SimilaritySearchResult[]> {
    // Format the query vector as a Postgres vector literal
    const vectorLiteral = `[${queryVector.join(',')}]`;

    // Raw query to pgvector
    // Uses the <-> operator for L2 distance (or <=> for cosine distance).
    // Note: If you want cosine distance, ensure embeddings are normalized or use <=>.
    const results = await prisma.$queryRaw<
      Array<{
        chunkIndex: number;
        content: string;
        metadata: any;
        distance: number;
      }>
    >`
      SELECT 
        "chunkIndex", 
        "content", 
        "metadata", 
        "embedding" <-> ${vectorLiteral}::vector AS distance
      FROM "Embedding"
      WHERE "tenantId" = ${tenantId}::uuid
      ORDER BY "embedding" <-> ${vectorLiteral}::vector
      LIMIT ${k};
    `;

    return results;
  }
}

export const vectorStoreService = new VectorStoreService();
