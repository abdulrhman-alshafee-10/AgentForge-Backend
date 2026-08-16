import { prisma } from '../../db/prisma.js';
import type { Prisma, Message } from '@prisma/client';

export class MessagesRepository {
  async create(data: Prisma.MessageUncheckedCreateInput): Promise<Message> {
    return prisma.message.create({ data });
  }

  async findMany(
    chatId: string,
    limit: number,
    cursor?: string,
  ): Promise<Message[]> {
    return prisma.message.findMany({
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

export const messagesRepository = new MessagesRepository();
