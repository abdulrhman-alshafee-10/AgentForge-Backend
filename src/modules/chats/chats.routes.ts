import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { validate } from '../../common/middleware/validate.js';
import { wrap } from '../../common/utils/async-wrap.js';
import { chatsService } from './chats.service.js';
import { chatOwnership } from '../../common/middleware/chat-ownership.js';
import { PaginationSchema } from '../../common/utils/pagination.js';

// ─── Validation schemas ───────────────────────────────────────────────────────

const CreateChatSchema = z.object({
  title: z.string().optional(),
  agentId: z.string().uuid(),
});

const UpdateChatSchema = z.object({
  title: z.string().min(1).optional(),
  archivedAt: z.string().datetime().optional().nullable(),
});

const ListChatsSchema = PaginationSchema.extend({
  includeArchived: z
    .string()
    .optional()
    .transform((val) => val === 'true'),
});

// ─── Router ───────────────────────────────────────────────────────────────────

const router = Router();

/**
 * POST /chats
 * Create a chat.
 */
router.post(
  '/',
  validate({ body: CreateChatSchema }),
  wrap(async (req: Request, res: Response) => {
    const { title, agentId } = req.body;
    const chat = await chatsService.createChat(req.user!.tenantId, req.user!.id, agentId, title);
    res.status(201).json({ chat });
  }),
);

/**
 * GET /chats
 * List chats for the current user.
 */
router.get(
  '/',
  validate({ query: ListChatsSchema }),
  wrap(async (req: Request, res: Response) => {
    const { cursor, limit, includeArchived } = req.query as any;
    const result = await chatsService.listChats(
      req.user!.tenantId,
      req.user!.id,
      limit,
      cursor,
      includeArchived,
    );
    res.json(result);
  }),
);

/**
 * GET /chats/:chatId
 */
router.get(
  '/:chatId',
  chatOwnership(),
  wrap(async (req: Request, res: Response) => {
    // req.chat is populated by chatOwnership middleware
    res.json({ chat: req.chat });
  }),
);

/**
 * PATCH /chats/:chatId
 * Rename or archive.
 */
router.patch(
  '/:chatId',
  chatOwnership(),
  validate({ body: UpdateChatSchema }),
  wrap(async (req: Request, res: Response) => {
    const { title, archivedAt } = req.body;
    const updates: any = {};
    if (title !== undefined) updates.title = title;
    if (archivedAt !== undefined) updates.archivedAt = archivedAt ? new Date(archivedAt) : null;
    
    const chat = await chatsService.updateChat(req.params.chatId as string, updates);
    res.json({ chat });
  }),
);

/**
 * DELETE /chats/:chatId
 * Soft-delete.
 */
router.delete(
  '/:chatId',
  chatOwnership(),
  wrap(async (req: Request, res: Response) => {
    await chatsService.deleteChat(req.params.chatId as string);
    res.status(204).send();
  }),
);

/**
 * POST /chats/:chatId/reopen
 * Restore an archived chat.
 */
router.post(
  '/:chatId/reopen',
  chatOwnership(),
  wrap(async (req: Request, res: Response) => {
    const chat = await chatsService.reopenChat(req.params.chatId as string);
    res.json({ chat });
  }),
);

// ─── Nested routers ───────────────────────────────────────────────────────────
import { messagesRouter } from '../messages/messages.routes.js';
import { executionsRouter } from '../executions/executions.routes.js';

router.use('/:chatId/messages', messagesRouter);
router.use('/:chatId/executions', executionsRouter);

export { router as chatsRouter };
