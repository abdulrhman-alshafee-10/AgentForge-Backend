import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { validate } from '../../common/middleware/validate.js';
import { wrap } from '../../common/utils/async-wrap.js';
import { PaginationSchema } from '../../common/utils/pagination.js';
import { memoryService } from './memory.service.js';

const router = Router();

// ─── Schemas ──────────────────────────────────────────────────────────────────

const ListQuerySchema = PaginationSchema.extend({
  userId: z.string().uuid().optional(),
  chatId: z.string().uuid().optional(),
  kind: z.enum(['preference', 'fact', 'summary', 'note']).optional(),
});

const CreateBodySchema = z.object({
  userId: z.string().uuid().optional(),
  chatId: z.string().uuid().optional(),
  kind: z.enum(['preference', 'fact', 'summary', 'note']),
  key: z.string().max(255).optional(),
  content: z.string().min(1).max(10_000),
  metadata: z.record(z.unknown()).optional(),
});

const UpdateBodySchema = z.object({
  content: z.string().min(1).max(10_000).optional(),
  metadata: z.record(z.unknown()).optional(),
});

// ─── GET /memories ────────────────────────────────────────────────────────────

router.get(
  '/',
  validate({ query: ListQuerySchema }),
  wrap(async (req: Request, res: Response) => {
    const query = req.query as unknown as z.infer<typeof ListQuerySchema>;
    const result = await memoryService.list({
      tenantId: req.user!.tenantId,
      userId: query.userId ?? req.user!.id,
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.chatId ? { chatId: query.chatId } : {}),
      limit: query.limit,
      ...(query.cursor ? { cursor: query.cursor } : {}),
    });
    res.json(result);
  }),
);

// ─── POST /memories ───────────────────────────────────────────────────────────

router.post(
  '/',
  validate({ body: CreateBodySchema }),
  wrap(async (req: Request, res: Response) => {
    const body = req.body as z.infer<typeof CreateBodySchema>;
    const memory = await memoryService.save({
      tenantId: req.user!.tenantId,
      userId: body.userId ?? req.user!.id,
      kind: body.kind,
      content: body.content,
      ...(body.chatId ? { chatId: body.chatId } : {}),
      ...(body.key ? { key: body.key } : {}),
      ...(body.metadata ? { metadata: body.metadata } : {}),
    });
    res.status(201).json({ memory });
  }),
);

// ─── PATCH /memories/:memoryId ────────────────────────────────────────────────

router.patch(
  '/:memoryId',
  validate({ body: UpdateBodySchema }),
  wrap(async (req: Request, res: Response) => {
    const body = req.body as z.infer<typeof UpdateBodySchema>;
    const memory = await memoryService.update(
      req.params.memoryId!,
      req.user!.tenantId,
      req.user!.id,
      {
        ...(body.content !== undefined ? { content: body.content } : {}),
        ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
      },
    );
    res.json({ memory });
  }),
);

// ─── DELETE /memories/:memoryId ───────────────────────────────────────────────

router.delete(
  '/:memoryId',
  wrap(async (req: Request, res: Response) => {
    await memoryService.delete(
      req.params.memoryId!,
      req.user!.tenantId,
      req.user!.id,
    );
    res.status(204).send();
  }),
);

export { router as memoryRouter };
