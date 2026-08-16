import { Router } from 'express';
import { wrap } from '../../common/utils/async-wrap.js';
import { live, ready } from './health.controller.js';

// ─── Health router ────────────────────────────────────────────────────────────
//
// Mounted at /api/v1/health in app.ts

const router = Router();

router.get('/live', live);
router.get('/ready', wrap(ready));

export { router as healthRouter };
