import { Router } from 'express';
import { wrap } from '../../common/utils/async-wrap.js';
import { live, ready, queues } from './health.controller.js';

// ─── Health router ────────────────────────────────────────────────────────────
//
// Mounted at /api/v1/health in app.ts.
// All endpoints are public (no authentication required).

const router = Router();

/** Liveness: is the process alive? */
router.get('/live', live);

/** Readiness: are all dependencies reachable? */
router.get('/ready', wrap(ready));

/** Queue stats: BullMQ job counts (admin/monitoring use) */
router.get('/queues', wrap(queues));

export { router as healthRouter };
