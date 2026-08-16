import { Router, type Request, type Response } from 'express';
import { validate } from '../../common/middleware/validate.js';
import { wrap } from '../../common/utils/async-wrap.js';
import { chatOwnership } from '../../common/middleware/chat-ownership.js';
import { PaginationSchema } from '../../common/utils/pagination.js';
import { executionsService } from './executions.service.js';

import { executionOwnership } from '../../common/middleware/execution-ownership.js';
import { eventsService } from './events.service.js';

const router = Router({ mergeParams: true });

/**
 * GET /executions/:executionId
 */
router.get(
  '/:executionId',
  executionOwnership(),
  wrap(async (req: Request, res: Response) => {
    res.json({ execution: req.execution });
  })
);

/**
 * GET /executions/:executionId/events
 */
router.get(
  '/:executionId/events',
  executionOwnership(),
  validate({ query: PaginationSchema }),
  wrap(async (req: Request, res: Response) => {
    const { cursor, limit } = req.query as any;
    const result = await eventsService.getEvents(req.params.executionId, limit, cursor);
    res.json(result);
  })
);

/**
 * GET /chats/:chatId/executions
 * (Mounted on /chats/:chatId/executions via chatsRouter)
 */
router.get(
  '/',
  chatOwnership(),
  validate({ query: PaginationSchema }),
  wrap(async (req: Request, res: Response) => {
    const { cursor, limit } = req.query as any;
    const result = await executionsService.listExecutions(req.params.chatId, limit, cursor);
    res.json(result);
  })
);

export { router as executionsRouter };
