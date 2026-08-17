// ─── Memory service ───────────────────────────────────────────────────────────
import { prisma } from '../../db/prisma.js';
import { embeddingsProvider } from '../vector-store/embeddings.provider.js';
import { paginate, decodeCursor } from '../../common/utils/pagination.js';
import { NotFoundError } from '../../common/errors/HttpErrors.js';
import { logger } from '../../common/logger/logger.js';
import type { Prisma, Memory } from '@prisma/client';

// Cosine distance below this threshold → merge instead of insert
const DEDUP_THRESHOLD = 0.08;

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
  /**
   * Saves a memory with three strategies (in order):
   * 1. Key-based upsert if `key` is provided.
   * 2. Near-duplicate merge if cosine distance < DEDUP_THRESHOLD.
   * 3. Fresh insert.
   */
  async save(options: SaveMemoryOptions): Promise<Memory> {
    const { tenantId, userId, chatId, kind, key, content, metadata = {} } = options;
    const vector = await embeddingsProvider.embedQuery(content);
    const vectorLiteral = `[${vector.join(',')}]`;

    if (key) {
      const existing = await prisma.memory.findFirst({ where: { tenantId, userId, key } });
      if (existing) {
        const memory = await prisma.memory.update({
          where: { id: existing.id },
          data: { content, metadata: metadata as Prisma.InputJsonValue, updatedAt: new Date() },
        });
        await this.upsertEmbedding(tenantId, existing.id, content, vectorLiteral, existing.embeddingId ?? undefined);
        return memory;
      }
    }

    if (!key) {
      const near = await this.findNearDuplicate(tenantId, userId, vectorLiteral, kind);
      if (near) {
        logger.debug({ memoryId: near.id, distance: near.distance }, 'Memory: merging near-duplicate');
        const memory = await prisma.memory.update({
          where: { id: near.id },
          data: { content, metadata: metadata as Prisma.InputJsonValue, updatedAt: new Date() },
        });
        await this.upsertEmbedding(tenantId, near.id, content, vectorLiteral, near.embeddingId ?? undefined);
        return memory;
      }
    }

    const memory = await prisma.memory.create({
      data: {
        tenantId, userId,
        ...(chatId ? { chatId } : {}),
        kind,
        ...(key ? { key } : {}),
        content,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });

    const embeddingId = await this.insertEmbedding(tenantId, memory.id, content, vectorLiteral);
    await prisma.memory.update({ where: { id: memory.id }, data: { embeddingId } });
    return memory;
  }

  /** Cosine similarity search scoped to tenant + user. */
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
    return this.searchRaw(tenantId, userId, vectorLiteral, k, kind, chatId);
  }

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
      where: { tenantId, userId, ...(kind ? { kind } : {}), ...(chatId ? { chatId } : {}) },
      take: limit + 1,
      ...(decodedCursor ? { cursor: { id: decodedCursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
    });
    return paginate(items, limit, (m) => m.id);
  }

  async getById(memoryId: string, tenantId: string, userId: string): Promise<Memory> {
    const memory = await prisma.memory.findUnique({ where: { id: memoryId } });
    if (!memory || memory.tenantId !== tenantId || memory.userId !== userId) throw new NotFoundError('Memory');
    return memory;
  }

  async update(memoryId: string, tenantId: string, userId: string, data: { content?: string; metadata?: Record<string, unknown> }): Promise<Memory> {
    const memory = await this.getById(memoryId, tenantId, userId);
    const updated = await prisma.memory.update({
      where: { id: memory.id },
      data: {
        ...(data.content ? { content: data.content } : {}),
        ...(data.metadata ? { metadata: data.metadata as Prisma.InputJsonValue } : {}),
      },
    });
    if (data.content) {
      const vector = await embeddingsProvider.embedQuery(data.content);
      await this.upsertEmbedding(tenantId, memory.id, data.content, `[${vector.join(',')}]`, memory.embeddingId ?? undefined);
    }
    return updated;
  }

  async delete(memoryId: string, tenantId: string, userId: string): Promise<void> {
    const memory = await this.getById(memoryId, tenantId, userId);
    if (memory.embeddingId) {
      await prisma.embedding.delete({ where: { id: memory.embeddingId } }).catch(() => {});
    }
    await prisma.memory.delete({ where: { id: memory.id } });
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async searchRaw(
    tenantId: string,
    userId: string,
    vectorLiteral: string,
    k: number,
    kind?: string,
    chatId?: string,
  ): Promise<MemorySearchResult[]> {
    interface RawRow { id: string; kind: string; key: string | null; content: string; metadata: unknown; distance: number; createdAt: Date }
    let rows: RawRow[];

    if (kind && chatId) {
      rows = await prisma.$queryRaw<RawRow[]>`
        SELECT m."id",m."kind",m."key",m."content",m."metadata",e."embedding"<=>${vectorLiteral}::vector AS distance,m."createdAt"
        FROM "Memory" m JOIN "Embedding" e ON e."id"=m."embeddingId"
        WHERE m."tenantId"=${tenantId}::uuid AND m."userId"=${userId}::uuid AND m."kind"=${kind} AND m."chatId"=${chatId}::uuid AND e."embedding" IS NOT NULL
        ORDER BY e."embedding"<=>${vectorLiteral}::vector LIMIT ${k}`;
    } else if (kind) {
      rows = await prisma.$queryRaw<RawRow[]>`
        SELECT m."id",m."kind",m."key",m."content",m."metadata",e."embedding"<=>${vectorLiteral}::vector AS distance,m."createdAt"
        FROM "Memory" m JOIN "Embedding" e ON e."id"=m."embeddingId"
        WHERE m."tenantId"=${tenantId}::uuid AND m."userId"=${userId}::uuid AND m."kind"=${kind} AND e."embedding" IS NOT NULL
        ORDER BY e."embedding"<=>${vectorLiteral}::vector LIMIT ${k}`;
    } else {
      rows = await prisma.$queryRaw<RawRow[]>`
        SELECT m."id",m."kind",m."key",m."content",m."metadata",e."embedding"<=>${vectorLiteral}::vector AS distance,m."createdAt"
        FROM "Memory" m JOIN "Embedding" e ON e."id"=m."embeddingId"
        WHERE m."tenantId"=${tenantId}::uuid AND m."userId"=${userId}::uuid AND e."embedding" IS NOT NULL
        ORDER BY e."embedding"<=>${vectorLiteral}::vector LIMIT ${k}`;
    }

    return rows.map((r) => ({ ...r, metadata: (r.metadata as Record<string, unknown>) ?? {} }));
  }

  private async findNearDuplicate(tenantId: string, userId: string, vectorLiteral: string, kind: string) {
    interface NearRow { id: string; embeddingId: string | null; distance: number }
    const rows = await prisma.$queryRaw<NearRow[]>`
      SELECT m."id",m."embeddingId",e."embedding"<=>${vectorLiteral}::vector AS distance
      FROM "Memory" m JOIN "Embedding" e ON e."id"=m."embeddingId"
      WHERE m."tenantId"=${tenantId}::uuid AND m."userId"=${userId}::uuid AND m."kind"=${kind} AND e."embedding" IS NOT NULL
      ORDER BY e."embedding"<=>${vectorLiteral}::vector LIMIT 1`;
    const top = rows[0];
    return top && top.distance < DEDUP_THRESHOLD ? top : null;
  }

  private async insertEmbedding(tenantId: string, memoryId: string, content: string, vectorLiteral: string): Promise<string> {
    const result = await prisma.$queryRaw<[{ id: string }]>`
      INSERT INTO "Embedding"("id","tenantId","memoryId","chunkIndex","content","embedding","metadata","createdAt")
      VALUES(gen_random_uuid(),${tenantId}::uuid,${memoryId}::uuid,0,${content},${vectorLiteral}::vector,'{}'::jsonb,NOW())
      RETURNING "id"`;
    return result[0]!.id;
  }

  private async upsertEmbedding(tenantId: string, memoryId: string, content: string, vectorLiteral: string, existingEmbeddingId?: string): Promise<void> {
    if (existingEmbeddingId) {
      await prisma.$executeRaw`UPDATE "Embedding" SET "content"=${content},"embedding"=${vectorLiteral}::vector WHERE "id"=${existingEmbeddingId}::uuid`;
    } else {
      const newId = await this.insertEmbedding(tenantId, memoryId, content, vectorLiteral);
      await prisma.memory.update({ where: { id: memoryId }, data: { embeddingId: newId } });
    }
  }
}

export const memoryService = new MemoryService();
