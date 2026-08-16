import { prisma } from '../../db/prisma.js';
import type { Prisma, Execution } from '@prisma/client';

export class ExecutionsRepository {
  async create(data: Prisma.ExecutionUncheckedCreateInput): Promise<Execution> {
    return prisma.execution.create({ data });
  }

  async findById(id: string): Promise<Execution | null> {
    return prisma.execution.findUnique({ where: { id } });
  }

  async findMany(
    chatId: string,
    limit: number,
    cursor?: string,
  ): Promise<Execution[]> {
    return prisma.execution.findMany({
      where: { chatId },
      take: limit + 1,
      ...(cursor && {
        cursor: { id: cursor },
        skip: 1,
      }),
      orderBy: { createdAt: 'desc' },
    });
  }
}

export const executionsRepository = new ExecutionsRepository();
