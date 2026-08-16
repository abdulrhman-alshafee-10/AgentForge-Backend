import type { Request, Response } from 'express';
import { prisma } from '../../db/prisma.js';

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
 * Readiness probe: all dependencies are reachable.
 * Pings PostgreSQL via Prisma. Returns 503 if the DB is down.
 */
export async function ready(_req: Request, res: Response): Promise<void> {
  const checks: Record<string, 'ok' | 'error'> = {};

  // ── Database check ───────────────────────────────────────────────────────
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = 'ok';
  } catch {
    checks.database = 'error';
  }

  const allOk = Object.values(checks).every((v) => v === 'ok');

  res.status(allOk ? 200 : 503).json({
    status: allOk ? 'ok' : 'degraded',
    checks,
  });
}
