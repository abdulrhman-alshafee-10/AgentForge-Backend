import { prisma } from '../../db/prisma.js';
import type { Prisma, Chat } from '@prisma/client';

export class ChatsRepository {
  async create(data: Prisma.ChatUncheckedCreateInput): Promise<Chat> {
    return prisma.chat.create({ data });
  }

  async findMany(
    tenantId: string,
    userId: string,
    limit: number,
    cursor?: string,
    includeArchived: boolean = false,
  ): Promise<Chat[]> {
    const where: Prisma.ChatWhereInput = {
      tenantId,
      userId,
    };

    if (!includeArchived) {
      where.archivedAt = null;
    }

    return prisma.chat.findMany({
      where,
      take: limit + 1, // +1 for pagination
      ...(cursor && {
        cursor: { id: cursor },
        skip: 1, // Skip the cursor itself
      }),
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findById(id: string): Promise<Chat | null> {
    return prisma.chat.findUnique({
      where: { id },
    });
  }

  async update(id: string, data: Prisma.ChatUpdateInput): Promise<Chat> {
    return prisma.chat.update({
      where: { id },
      data,
    });
  }

  async softDelete(id: string): Promise<Chat> {
    return prisma.chat.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
  }

  async reopen(id: string): Promise<Chat> {
    return prisma.chat.update({
      where: { id },
      data: { archivedAt: null },
    });
  }
}

export const chatsRepository = new ChatsRepository();
