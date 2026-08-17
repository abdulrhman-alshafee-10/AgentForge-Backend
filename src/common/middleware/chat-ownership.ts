// ─── Chat ownership middleware ────────────────────────────────────────────────
import { type Request, type Response, type NextFunction } from 'express';
import { prisma } from '../../db/prisma.js';
import { ValidationError, NotFoundError, UnauthenticatedError } from '../errors/HttpErrors.js';

/** Loads req.params.chatId, asserts tenant+user ownership, attaches req.chat. */
export function chatOwnership() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const chatId = req.params.chatId;
      if (!chatId) throw new ValidationError('chatId is required');
      if (!req.user) throw new UnauthenticatedError();

      const chat = await prisma.chat.findUnique({ where: { id: chatId } });
      if (!chat || chat.tenantId !== req.user.tenantId || chat.userId !== req.user.id) {
        throw new NotFoundError('Chat');
      }

      req.chat = chat;
      next();
    } catch (error) {
      next(error);
    }
  };
}
