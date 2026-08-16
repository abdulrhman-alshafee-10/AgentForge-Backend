import { Router, type Request, type Response } from 'express';
import { validate } from '../../common/middleware/validate.js';
import { wrap } from '../../common/utils/async-wrap.js';
import { chatOwnership } from '../../common/middleware/chat-ownership.js';
import { PaginationSchema } from '../../common/utils/pagination.js';
import { executionsService } from './executions.service.js';

const router = Router({ mergeParams: true });

/**
 * GET /executions/:executionId
 */
router.get(
  '/:executionId',
  wrap(async (req: Request, res: Response) => {
    const execution = await executionsService.getExecution(
      req.params.executionId,
      req.user!.tenantId,
      req.user!.id,
    );
    res.json({ execution });
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
