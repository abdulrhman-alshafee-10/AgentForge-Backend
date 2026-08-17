import { prisma } from '../../db/prisma.js';
import { embeddingsProvider } from '../vector-store/embeddings.provider.js';
import { paginate, decodeCursor } from '../../common/utils/pagination.js';
import { NotFoundError } from '../../common/errors/HttpErrors.js';
import { logger } from '../../common/logger/logger.js';
import type { Prisma, Memory } from '@prisma/client';

// ─── Similarity deduplication threshold ──────────────────────────────────────
// Cosine distance below this value means the new memory is too similar to an
// existing one — we update instead of inserting.
const DEDUP_THRESHOLD = 0.08;

// ─── Memory kinds ─────────────────────────────────────────────────────────────
export type MemoryKind = 'preference' | 'fact' | 'summary' | 'note';

export interface SaveMemoryOptions {
  tenantId: string;
  userId: string;
  chatId?: string;
  kind: MemoryKind;
  key?: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface MemorySearchResult {
  id: string;
  kind: string;
  key: string | null;
  content: string;
  metadata: Record<string, unknown>;
  distance: number;
  createdAt: Date;
}

export class MemoryService {
  // ─── Save (create or upsert) ────────────────────────────────────────────────
  //
  // 1. Embed the content.
  // 2. If a key is provided, upsert by (tenantId, userId, key).
  // 3. If no key, check for a near-duplicate via vector similarity.
  //    If found (distance < DEDUP_THRESHOLD), update it instead.
  // 4. Otherwise insert a new row.
  // 5. Always insert/update the Embedding row.

  async save(options: SaveMemoryOptions): Promise<Memory> {
    const { tenantId, userId, chatId, kind, key, content, metadata = {} } = options;

    // Embed the content
    const vector = await embeddingsProvider.embedQuery(content);
    const vectorLiteral = `[${vector.join(',')}]`;

    // ── Key-based upsert ────────────────────────────────────────────────────
    if (key) {
      const existing = await prisma.memory.findFirst({
        where: { tenantId, userId, key },
      });

      if (existing) {
        const memory = await prisma.memory.update({
          where: { id: existing.id },
          data: { content, metadata: metadata as Prisma.InputJsonValue, updatedAt: new Date() },
        });
        await this.upsertEmbedding(tenantId, existing.id, content, vectorLiteral, existing.embeddingId ?? undefined);
        return memory;
      }
    }

    // ── Similarity deduplication (no key) ───────────────────────────────────
    if (!key) {
      const near = await this.findNearDuplicate(tenantId, userId, vectorLiteral, kind);
      if (near) {
        logger.debug(
          { memoryId: near.id, distance: near.distance },
          'Memory: merging near-duplicate',
        );
        const memory = await prisma.memory.update({
          where: { id: near.id },
          data: { content, metadata: metadata as Prisma.InputJsonValue, updatedAt: new Date() },
        });
        await this.upsertEmbedding(tenantId, near.id, content, vectorLiteral, near.embeddingId ?? undefined);
        return memory;
      }
    }

    // ── Insert new memory ───────────────────────────────────────────────────
    const memory = await prisma.memory.create({
      data: {
        tenantId,
        userId,
        ...(chatId ? { chatId } : {}),
        kind,
        ...(key ? { key } : {}),
        content,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });

    const embeddingId = await this.insertEmbedding(tenantId, memory.id, content, vectorLiteral);

    // Link embedding back to memory
    await prisma.memory.update({
      where: { id: memory.id },
      data: { embeddingId },
    });

    return memory;
  }

  // ─── Vector similarity search ───────────────────────────────────────────────

  async search(options: {
    tenantId: string;
    userId: string;
    query: string;
    k?: number;
    kind?: string;
    chatId?: string;
  }): Promise<MemorySearchResult[]> {
    const { tenantId, userId, query, k = 4, kind, chatId } = options;

    const vector = await embeddingsProvider.embedQuery(query);
    const vectorLiteral = `[${vector.join(',')}]`;

    // Build the filter conditions
    const userFilter = `AND m."userId" = ${userId ? `'${userId}'::uuid` : 'NULL'}`;
    const kindFilter = kind ? `AND m."kind" = '${kind.replace(/'/g, "''")}'` : '';
    const chatFilter = chatId ? `AND m."chatId" = '${chatId.replace(/'/g, "''")}'::uuid` : '';

    interface RawRow {
      id: string;
      kind: string;
      key: string | null;
      content: string;
      metadata: unknown;
      distance: number;
      createdAt: Date;
    }

    const rows = await prisma.$queryRaw<RawRow[]>`
      SELECT
        m."id",
        m."kind",
        m."key",
        m."content",
        m."metadata",
        e."embedding" <=> ${vectorLiteral}::vector AS distance,
        m."createdAt"
      FROM "Memory" m
      JOIN "Embedding" e ON e."id" = m."embeddingId"
      WHERE m."tenantId" = ${tenantId}::uuid
        AND e."embedding" IS NOT NULL
        ${userId ? prisma.$queryRaw`AND m."userId" = ${userId}::uuid` : prisma.$queryRaw``}
      ORDER BY e."embedding" <=> ${vectorLiteral}::vector
      LIMIT ${k}
    `;

    // Note: We use a simpler approach via Prisma raw with safer parameterisation below
    // The above has a limitation with conditional parts — use the repository approach
    return this.searchRaw(tenantId, userId, vectorLiteral, k, kind, chatId);
  }

  // ─── Raw parameterized search ───────────────────────────────────────────────

  private async searchRaw(
    tenantId: string,
    userId: string,
    vectorLiteral: string,
    k: number,
    kind?: string,
    chatId?: string,
  ): Promise<MemorySearchResult[]> {
    interface RawRow {
      id: string;
      kind: string;
      key: string | null;
      content: string;
      metadata: unknown;
      distance: number;
      createdAt: Date;
    }

    let rows: RawRow[];

    if (kind && chatId) {
      rows = await prisma.$queryRaw<RawRow[]>`
        SELECT m."id", m."kind", m."key", m."content", m."metadata",
               e."embedding" <=> ${vectorLiteral}::vector AS distance, m."createdAt"
        FROM "Memory" m JOIN "Embedding" e ON e."id" = m."embeddingId"
        WHERE m."tenantId" = ${tenantId}::uuid AND m."userId" = ${userId}::uuid
          AND m."kind" = ${kind} AND m."chatId" = ${chatId}::uuid
          AND e."embedding" IS NOT NULL
        ORDER BY e."embedding" <=> ${vectorLiteral}::vector LIMIT ${k}`;
    } else if (kind) {
      rows = await prisma.$queryRaw<RawRow[]>`
        SELECT m."id", m."kind", m."key", m."content", m."metadata",
               e."embedding" <=> ${vectorLiteral}::vector AS distance, m."createdAt"
        FROM "Memory" m JOIN "Embedding" e ON e."id" = m."embeddingId"
        WHERE m."tenantId" = ${tenantId}::uuid AND m."userId" = ${userId}::uuid
          AND m."kind" = ${kind} AND e."embedding" IS NOT NULL
        ORDER BY e."embedding" <=> ${vectorLiteral}::vector LIMIT ${k}`;
    } else {
      rows = await prisma.$queryRaw<RawRow[]>`
        SELECT m."id", m."kind", m."key", m."content", m."metadata",
               e."embedding" <=> ${vectorLiteral}::vector AS distance, m."createdAt"
        FROM "Memory" m JOIN "Embedding" e ON e."id" = m."embeddingId"
        WHERE m."tenantId" = ${tenantId}::uuid AND m."userId" = ${userId}::uuid
          AND e."embedding" IS NOT NULL
        ORDER BY e."embedding" <=> ${vectorLiteral}::vector LIMIT ${k}`;
    }

    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      key: r.key,
      content: r.content,
      metadata: (r.metadata as Record<string, unknown>) ?? {},
      distance: r.distance,
      createdAt: r.createdAt,
    }));
  }

  // ─── List (cursor-paginated, no vector) ─────────────────────────────────────

  async list(options: {
    tenantId: string;
    userId: string;
    kind?: string;
    chatId?: string;
    limit: number;
    cursor?: string;
  }) {
    const { tenantId, userId, kind, chatId, limit, cursor } = options;
    const decodedCursor = cursor ? decodeCursor(cursor) : undefined;

    const items = await prisma.memory.findMany({
      where: {
        tenantId,
        userId,
        ...(kind ? { kind } : {}),
        ...(chatId ? { chatId } : {}),
      },
      take: limit + 1,
      ...(decodedCursor ? { cursor: { id: decodedCursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
    });

    return paginate(items, limit, (m) => m.id);
  }

  // ─── Get single ─────────────────────────────────────────────────────────────

  async getById(memoryId: string, tenantId: string, userId: string): Promise<Memory> {
    const memory = await prisma.memory.findUnique({ where: { id: memoryId } });
    if (!memory || memory.tenantId !== tenantId || memory.userId !== userId) {
      throw new NotFoundError('Memory');
    }
    return memory;
  }

  // ─── Update ─────────────────────────────────────────────────────────────────

  async update(
    memoryId: string,
    tenantId: string,
    userId: string,
    data: { content?: string; metadata?: Record<string, unknown> },
  ): Promise<Memory> {
    const memory = await this.getById(memoryId, tenantId, userId);

    const updated = await prisma.memory.update({
      where: { id: memory.id },
      data: {
        ...(data.content ? { content: data.content } : {}),
        ...(data.metadata ? { metadata: data.metadata as Prisma.InputJsonValue } : {}),
      },
    });

    // Re-embed if content changed
    if (data.content) {
      const vector = await embeddingsProvider.embedQuery(data.content);
      const vectorLiteral = `[${vector.join(',')}]`;
      await this.upsertEmbedding(tenantId, memory.id, data.content, vectorLiteral, memory.embeddingId ?? undefined);
    }

    return updated;
  }

  // ─── Delete ─────────────────────────────────────────────────────────────────

  async delete(memoryId: string, tenantId: string, userId: string): Promise<void> {
    const memory = await this.getById(memoryId, tenantId, userId);
    // Embedding is unlinked but not cascade-deleted from Embedding table
    // (Memory.embeddingId is a non-cascade FK). Delete it explicitly.
    if (memory.embeddingId) {
      await prisma.embedding.delete({ where: { id: memory.embeddingId } }).catch(() => {});
    }
    await prisma.memory.delete({ where: { id: memory.id } });
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private async findNearDuplicate(
    tenantId: string,
    userId: string,
    vectorLiteral: string,
    kind: string,
  ): Promise<{ id: string; embeddingId: string | null; distance: number } | null> {
    interface NearRow { id: string; embeddingId: string | null; distance: number }

    const rows = await prisma.$queryRaw<NearRow[]>`
      SELECT m."id", m."embeddingId",
             e."embedding" <=> ${vectorLiteral}::vector AS distance
      FROM "Memory" m JOIN "Embedding" e ON e."id" = m."embeddingId"
      WHERE m."tenantId" = ${tenantId}::uuid
        AND m."userId" = ${userId}::uuid
        AND m."kind" = ${kind}
        AND e."embedding" IS NOT NULL
      ORDER BY e."embedding" <=> ${vectorLiteral}::vector
      LIMIT 1
    `;

    const top = rows[0];
    if (!top || top.distance > DEDUP_THRESHOLD) return null;
    return top;
  }

  private async insertEmbedding(
    tenantId: string,
    memoryId: string,
    content: string,
    vectorLiteral: string,
  ): Promise<string> {
    const result = await prisma.$queryRaw<[{ id: string }]>`
      INSERT INTO "Embedding" ("id", "tenantId", "memoryId", "chunkIndex", "content", "embedding", "metadata", "createdAt")
      VALUES (gen_random_uuid(), ${tenantId}::uuid, ${memoryId}::uuid, 0, ${content}, ${vectorLiteral}::vector, '{}'::jsonb, NOW())
      RETURNING "id"
    `;
    return result[0]!.id;
  }

  private async upsertEmbedding(
    tenantId: string,
    memoryId: string,
    content: string,
    vectorLiteral: string,
    existingEmbeddingId?: string,
  ): Promise<void> {
    if (existingEmbeddingId) {
      await prisma.$executeRaw`
        UPDATE "Embedding"
        SET "content" = ${content},
            "embedding" = ${vectorLiteral}::vector
        WHERE "id" = ${existingEmbeddingId}::uuid
      `;
    } else {
      const newId = await this.insertEmbedding(tenantId, memoryId, content, vectorLiteral);
      await prisma.memory.update({ where: { id: memoryId }, data: { embeddingId: newId } });
    }
  }
}

export const memoryService = new MemoryService();
