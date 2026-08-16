import { Router } from 'express';
import { live, ready } from './health.controller.js';

// ─── Health router ────────────────────────────────────────────────────────────
//
// Mounted at /api/v1/health in app.ts

const router = Router();

router.get('/live', live);
router.get('/ready', ready);

export { router as healthRouter };
