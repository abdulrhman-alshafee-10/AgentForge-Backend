import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { validate } from '../../common/middleware/validate.js';
import { wrap } from '../../common/utils/async-wrap.js';
import { chatOwnership } from '../../common/middleware/chat-ownership.js';
import { PaginationSchema } from '../../common/utils/pagination.js';
import { messagesService } from './messages.service.js';

// ─── Validation schemas ───────────────────────────────────────────────────────

const CreateMessageSchema = z.object({
  content: z.string().min(1),
  attachments: z.array(z.object({ documentId: z.string().uuid() })).optional(),
});

// ─── Router ───────────────────────────────────────────────────────────────────

const router = Router({ mergeParams: true });

/**
 * POST /chats/:chatId/messages
 */
router.post(
  '/',
  chatOwnership(),
  validate({ body: CreateMessageSchema }),
  wrap(async (req: Request, res: Response) => {
    const idempotencyKey = req.header('Idempotency-Key');
    const { content, attachments } = req.body;
    
    // We assume the frontend passes the agentId when it created the chat.
    // The chat object is attached by the chatOwnership middleware.
    const chat = req.chat!;
    
    const result = await messagesService.createMessage(
      req.user!.tenantId,
      req.user!.id,
      chat.id,
      chat.agentId,
      content,
      attachments,
      idempotencyKey
    );
    
    res.status(201).json(result);
  })
);

/**
 * GET /chats/:chatId/messages
 */
router.get(
  '/',
  chatOwnership(),
  validate({ query: PaginationSchema }),
  wrap(async (req: Request, res: Response) => {
    const { cursor, limit } = req.query as any;
    const result = await messagesService.listMessages(req.params.chatId, limit, cursor);
    res.json(result);
  })
);

export { router as messagesRouter };
