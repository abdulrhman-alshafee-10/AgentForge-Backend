import { messagesRepository } from './messages.repository.js';
import { paginate, decodeCursor } from '../../common/utils/pagination.js';
import { prisma } from '../../db/prisma.js';
import { ExecutionStatus, MessageRole } from '@prisma/client';
import { agentRunnerService } from '../agents/agent-runner.service.js';
import { logger } from '../../common/logger/logger.js';

export class MessagesService {
  async listMessages(chatId: string, limit: number, cursor?: string) {
    const decodedCursor = cursor ? decodeCursor(cursor) : undefined;
    const items = await messagesRepository.findMany(chatId, limit, decodedCursor);
    return paginate(items, limit, (message) => message.id);
  }

  async createMessage(
    tenantId: string,
    userId: string,
    chatId: string,
    agentId: string,
    content: string,
    attachments?: any[],
    idempotencyKey?: string,
  ) {
    if (idempotencyKey) {
      // Check for existing idempotency key
      const existing = await prisma.idempotencyKey.findUnique({
        where: { key: idempotencyKey },
      });
      if (existing) {
        return existing.response;
      }
    }

    // Run creation in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // 1. Create the user message
      const message = await tx.message.create({
        data: {
          tenantId,
          chatId,
          role: MessageRole.user,
          content,
          metadata: attachments ? { attachments } : {},
        },
      });

      // 2. Create the execution
      const execution = await tx.execution.create({
        data: {
          tenantId,
          chatId,
          userId,
          agentId,
          inputMessageId: message.id,
          status: ExecutionStatus.CREATED,
        },
      });

      const responseBody = { message, execution };

      // 3. Save idempotency key if provided
      if (idempotencyKey) {
        await tx.idempotencyKey.create({
          data: {
            key: idempotencyKey,
            response: responseBody,
          },
        });
      }

      // 4. Auto-title the chat if it's the first message and still "New Chat"
      const chat = await tx.chat.findUnique({ where: { id: chatId } });
      if (chat && chat.title === 'New Chat') {
        const messageCount = await tx.message.count({ where: { chatId } });
        if (messageCount === 1) {
          const autoTitle = content.substring(0, 50).replace(/\n/g, ' ') + (content.length > 50 ? '...' : '');
          await tx.chat.update({
            where: { id: chatId },
            data: { title: autoTitle },
          });
        }
      }

      return responseBody;
    });

    // Fire-and-forget: run the agent workflow in-process.
    // Phase 09 will replace this with a BullMQ job enqueue.
    agentRunnerService.run(result.execution.id).catch((err) => {
      logger.error({ err, executionId: result.execution.id }, 'AgentRunner fire-and-forget failed');
    });

    return result;
  }
}

export const messagesService = new MessagesService();
