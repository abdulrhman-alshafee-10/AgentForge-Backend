import { prisma } from '../../db/prisma.js';
import type { Prisma, Checkpoint } from '@prisma/client';

// ─── Checkpoint Repository ────────────────────────────────────────────────────

export class CheckpointRepository {
  /** Persist a new checkpoint. */
  async create(data: Prisma.CheckpointUncheckedCreateInput): Promise<Checkpoint> {
    return prisma.checkpoint.create({ data });
  }

  /**
   * Return the most recent checkpoint for an execution.
   * Used on worker startup to decide whether to resume or start fresh.
   */
  async findLatest(executionId: string): Promise<Checkpoint | null> {
    return prisma.checkpoint.findFirst({
      where: { executionId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** All checkpoints for an execution, ascending (oldest first). */
  async findAll(executionId: string): Promise<Checkpoint[]> {
    return prisma.checkpoint.findMany({
      where: { executionId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Delete a batch of checkpoints by ID.
   * Used by the pruning logic.
   */
  async deleteMany(ids: string[]): Promise<number> {
    const result = await prisma.checkpoint.deleteMany({
      where: { id: { in: ids } },
    });
    return result.count;
  }
}

export const checkpointRepository = new CheckpointRepository();
