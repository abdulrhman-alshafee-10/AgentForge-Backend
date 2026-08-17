import { prisma } from '../../db/prisma.js';
import { ToolCallStatus } from '@prisma/client';
import type { Prisma, ToolCall } from '@prisma/client';

// ─── ToolCall Repository ──────────────────────────────────────────────────────

export class ToolCallRepository {
  async create(data: Prisma.ToolCallUncheckedCreateInput): Promise<ToolCall> {
    return prisma.toolCall.create({ data });
  }

  async findById(id: string): Promise<ToolCall | null> {
    return prisma.toolCall.findUnique({ where: { id } });
  }

  async findByExecution(executionId: string): Promise<ToolCall[]> {
    return prisma.toolCall.findMany({
      where: { executionId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Transition PENDING → RUNNING and record the start time. */
  async markRunning(id: string): Promise<ToolCall> {
    return prisma.toolCall.update({
      where: { id },
      data: {
        status: ToolCallStatus.RUNNING,
        startedAt: new Date(),
      },
    });
  }

  /** Transition RUNNING → SUCCESS and persist the output. */
  async markSuccess(id: string, output: Prisma.InputJsonValue): Promise<ToolCall> {
    return prisma.toolCall.update({
      where: { id },
      data: {
        status: ToolCallStatus.SUCCESS,
        output,
        finishedAt: new Date(),
      },
    });
  }

  /** Transition RUNNING → ERROR and persist the error payload. */
  async markError(id: string, error: Prisma.InputJsonValue): Promise<ToolCall> {
    return prisma.toolCall.update({
      where: { id },
      data: {
        status: ToolCallStatus.ERROR,
        error,
        finishedAt: new Date(),
      },
    });
  }

  /** Transition to CANCELLED (e.g. timeout). */
  async markCancelled(id: string): Promise<ToolCall> {
    return prisma.toolCall.update({
      where: { id },
      data: {
        status: ToolCallStatus.CANCELLED,
        finishedAt: new Date(),
      },
    });
  }
}

export const toolCallRepository = new ToolCallRepository();
