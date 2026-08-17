import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { validate } from '../../common/middleware/validate.js';
import { wrap } from '../../common/utils/async-wrap.js';
import { chatOwnership } from '../../common/middleware/chat-ownership.js';
import { PaginationSchema } from '../../common/utils/pagination.js';
import { executionsService } from './executions.service.js';
import { executionOwnership } from '../../common/middleware/execution-ownership.js';
import { eventsService } from './events.service.js';

const router = Router({ mergeParams: true });

// ─── Events query schema ──────────────────────────────────────────────────────

const EventsQuerySchema = PaginationSchema.extend({
  afterSequence: z.coerce.number().int().min(0).optional(),
});

// ─── GET /executions/:executionId ─────────────────────────────────────────────

router.get(
  '/:executionId',
  executionOwnership(),
  wrap(async (req: Request, res: Response) => {
    res.json({ execution: req.execution });
  }),
);

// ─── GET /executions/:executionId/events ──────────────────────────────────────
// Paginated cold event log — used for reconstruction when SSE is unavailable.
// Clients can supply ?afterSequence=N to start from a known position.

router.get(
  '/:executionId/events',
  executionOwnership(),
  validate({ query: EventsQuerySchema }),
  wrap(async (req: Request, res: Response) => {
    const query = req.query as unknown as z.infer<typeof EventsQuerySchema>;
    const result = await eventsService.getEvents(
      req.params.executionId as string,
      query.limit,
      query.cursor,
      query.afterSequence,
    );
    res.json(result);
  }),
);

// ─── GET /chats/:chatId/executions ────────────────────────────────────────────
// Mounted under /chats/:chatId/executions via the chats router.

router.get(
  '/',
  chatOwnership(),
  validate({ query: PaginationSchema }),
  wrap(async (req: Request, res: Response) => {
    const query = req.query as unknown as { cursor?: string; limit: number };
    const result = await executionsService.listExecutions(
      req.params.chatId!,
      query.limit,
      query.cursor,
    );
    res.json(result);
  }),
);

export { router as executionsRouter };

