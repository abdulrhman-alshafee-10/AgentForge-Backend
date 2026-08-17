import { Router, type Request, type Response } from 'express';
import { wrap } from '../../common/utils/async-wrap.js';
import { executionOwnership } from '../../common/middleware/execution-ownership.js';
import { checkpointRepository } from './checkpoint.repository.js';

// ─── Checkpoints router ───────────────────────────────────────────────────────
//
// Debug / admin endpoint.  Returns all checkpoints for an execution so
// engineers can inspect the state at each node boundary.

const router = Router({ mergeParams: true });

// ─── GET /executions/:executionId/checkpoints ─────────────────────────────────

router.get(
  '/:executionId/checkpoints',
  executionOwnership(),
  wrap(async (req: Request, res: Response) => {
    const checkpoints = await checkpointRepository.findAll(
      req.params.executionId!,
    );

    // Strip the full state blob from list responses to keep payloads small.
    // Consumers can call the individual checkpoint endpoint when they need state.
    const items = checkpoints.map((cp) => ({
      id: cp.id,
      nodeName: cp.nodeName,
      parentCheckpointId: cp.parentCheckpointId,
      createdAt: cp.createdAt,
    }));

    res.json({ items });
  }),
);

// ─── GET /executions/:executionId/checkpoints/:checkpointId ──────────────────
// Returns the full state blob for a single checkpoint.

router.get(
  '/:executionId/checkpoints/:checkpointId',
  executionOwnership(),
  wrap(async (req: Request, res: Response) => {
    const all = await checkpointRepository.findAll(req.params.executionId!);
    const cp = all.find((c) => c.id === req.params.checkpointId);

    if (!cp) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Checkpoint not found' } });
      return;
    }

    res.json({ checkpoint: cp });
  }),
);

export { router as checkpointsRouter };
