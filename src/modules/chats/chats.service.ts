import { chatsRepository } from './chats.repository.js';
import { paginate, decodeCursor } from '../../common/utils/pagination.js';
import type { Chat } from '@prisma/client';

export class ChatsService {
  async createChat(tenantId: string, userId: string, agentId: string, title?: string) {
    return chatsRepository.create({
      tenantId,
      userId,
      agentId,
      title: title || 'New Chat',
    });
  }

  async listChats(
    tenantId: string,
    userId: string,
    limit: number,
    cursor?: string,
    includeArchived: boolean = false,
  ) {
    const decodedCursor = cursor ? decodeCursor(cursor) : undefined;
    const items = await chatsRepository.findMany(
      tenantId,
      userId,
      limit,
      decodedCursor,
      includeArchived,
    );

    return paginate(items, limit, (chat) => chat.id);
  }

  async getChat(chatId: string) {
    // The middleware already loads the chat, but we might want extra details later.
    return chatsRepository.findById(chatId);
  }

  async updateChat(chatId: string, updates: { title?: string; archivedAt?: Date }) {
    return chatsRepository.update(chatId, updates);
  }

  async deleteChat(chatId: string) {
    return chatsRepository.softDelete(chatId);
  }

  async reopenChat(chatId: string) {
    return chatsRepository.reopen(chatId);
  }
}

export const chatsService = new ChatsService();
