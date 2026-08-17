import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { validate } from '../../common/middleware/validate.js';
import { wrap } from '../../common/utils/async-wrap.js';
import { chatOwnership } from '../../common/middleware/chat-ownership.js';
import { PaginationSchema } from '../../common/utils/pagination.js';
import { checkExecutionQuota } from '../../common/middleware/quota.js';
import { messagesService } from './messages.service.js';

const CreateMessageSchema = z.object({
  content: z.string().min(1),
  attachments: z.array(z.object({ documentId: z.string().uuid() })).optional(),
});

const router = Router({ mergeParams: true });

/**
 * POST /chats/:chatId/messages
 */
router.post(
  '/',
  chatOwnership(),
  checkExecutionQuota(),
  validate({ body: CreateMessageSchema }),
  wrap(async (req: Request, res: Response) => {
    const idempotencyKey = req.header('Idempotency-Key');
    const { content, attachments } = req.body;
    const chat = req.chat!;

    const result = await messagesService.createMessage(
      req.user!.tenantId,
      req.user!.id,
      chat.id,
      chat.agentId,
      content,
      attachments,
      idempotencyKey,
    );

    res.status(201).json(result);
  }),
);

/**
 * GET /chats/:chatId/messages
 */
router.get(
  '/',
  chatOwnership(),
  validate({ query: PaginationSchema }),
  wrap(async (req: Request, res: Response) => {
    const query = req.query as unknown as { cursor?: string; limit: number };
    const result = await messagesService.listMessages(
      req.params.chatId as string,
      query.limit,
      query.cursor,
    );
    res.json(result);
  }),
);

export { router as messagesRouter };
