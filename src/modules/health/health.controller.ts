import type { Request, Response } from 'express';

// ─── Health controller ────────────────────────────────────────────────────────

/**
 * GET /api/v1/health/live
 *
 * Liveness probe: the process is running.
 * Returns 200 immediately — no dependency checks.
 */
export function live(_req: Request, res: Response): void {
  res.status(200).json({ status: 'ok' });
}

/**
 * GET /api/v1/health/ready
 *
 * Readiness probe: the process can serve traffic (dependencies are up).
 * Phase 01: always 200. Phases 02+ will ping the DB and Redis.
 */
export function ready(_req: Request, res: Response): void {
  res.status(200).json({ status: 'ok', checks: {} });
}
