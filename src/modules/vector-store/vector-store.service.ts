import { prisma } from '../../db/prisma.js';

// ─── Result shape ──────────────────────────────────────────────────────────────

export interface SimilaritySearchResult {
  id: string;
  documentId: string | null;
  chunkIndex: number;
  content: string;
  metadata: Record<string, unknown>;
  /** Cosine distance from the query vector (lower = more similar). */
  distance: number;
}

export interface SimilaritySearchOptions {
  tenantId: string;
  queryVector: number[];
  k?: number;
  /** Optional: restrict search to a specific document */
  documentId?: string;
}

// ─── Raw row shape returned by $queryRaw ─────────────────────────────────────

interface RawEmbeddingRow {
  id: string;
  documentId: string | null;
  chunkIndex: number;
  content: string;
  metadata: unknown;
  distance: number;
}

export class VectorStoreService {
  /**
   * Cosine similarity search using pgvector's `<=>` operator.
   *
   * Cosine distance is preferred over L2 (`<->`) for text embeddings because
   * it is magnitude-insensitive — only the direction of the vector matters.
   * Lower distance values mean higher similarity (0 = identical).
   *
   * Results are tenant-scoped and ordered by ascending distance.
   */
  async similaritySearch(options: SimilaritySearchOptions): Promise<SimilaritySearchResult[]> {
    const { tenantId, queryVector, k = 4, documentId } = options;

    // Format as a Postgres vector literal: [0.1,0.2,...]
    const vectorLiteral = `[${queryVector.join(',')}]`;

    // Build the optional document filter clause.
    // We can't use conditional template literal tags easily, so we branch.
    let rows: RawEmbeddingRow[];

    if (documentId) {
      rows = await prisma.$queryRaw<RawEmbeddingRow[]>`
        SELECT
          "id",
          "documentId",
          "chunkIndex",
          "content",
          "metadata",
          "embedding" <=> ${vectorLiteral}::vector AS distance
        FROM "Embedding"
        WHERE "tenantId" = ${tenantId}::uuid
          AND "documentId" = ${documentId}::uuid
          AND "embedding" IS NOT NULL
        ORDER BY "embedding" <=> ${vectorLiteral}::vector
        LIMIT ${k}
      `;
    } else {
      rows = await prisma.$queryRaw<RawEmbeddingRow[]>`
        SELECT
          "id",
          "documentId",
          "chunkIndex",
          "content",
          "metadata",
          "embedding" <=> ${vectorLiteral}::vector AS distance
        FROM "Embedding"
        WHERE "tenantId" = ${tenantId}::uuid
          AND "embedding" IS NOT NULL
        ORDER BY "embedding" <=> ${vectorLiteral}::vector
        LIMIT ${k}
      `;
    }

    return rows.map((row) => ({
      id: row.id,
      documentId: row.documentId,
      chunkIndex: row.chunkIndex,
      content: row.content,
      metadata: (row.metadata as Record<string, unknown>) ?? {},
      distance: row.distance,
    }));
  }
}

export const vectorStoreService = new VectorStoreService();
