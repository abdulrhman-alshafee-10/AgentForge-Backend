import type { Request, Response } from 'express';
import { prisma } from '../../db/prisma.js';
import { redis } from '../../redis/redis.js';
import { executionQueue } from '../../queues/queue.js';
import { logger } from '../../common/logger/logger.js';

// ─── Health controller ────────────────────────────────────────────────────────

/**
 * GET /api/v1/health/live
 *
 * Liveness probe — the process is up.
 * Returns 200 immediately with no dependency checks.
 * Kubernetes / Docker calls this to decide whether to restart the container.
 */
export function live(_req: Request, res: Response): void {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
}

/**
 * GET /api/v1/health/ready
 *
 * Readiness probe — all dependencies are reachable.
 * Returns 200 only when Postgres and Redis both respond.
 * Kubernetes calls this before routing traffic to the pod.
 */
export async function ready(_req: Request, res: Response): Promise<void> {
  const checks: Record<string, 'ok' | 'error'> = {};

  // ── PostgreSQL ────────────────────────────────────────────────────────────
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = 'ok';
  } catch {
    checks.database = 'error';
  }

  // ── Redis ─────────────────────────────────────────────────────────────────
  try {
    await redis.ping();
    checks.redis = 'ok';
  } catch {
    checks.redis = 'error';
  }

  const allOk = Object.values(checks).every((v) => v === 'ok');

  res.status(allOk ? 200 : 503).json({
    status: allOk ? 'ok' : 'degraded',
    checks,
    timestamp: new Date().toISOString(),
  });
}

/**
 * GET /api/v1/health/queues
 *
 * Admin queue metrics — BullMQ job counts by state.
 * Useful for dashboards and alerting on queue backlog.
 */
export async function queues(_req: Request, res: Response): Promise<void> {
  try {
    const [waiting, active, delayed, failed, completed] = await Promise.all([
      executionQueue.getWaitingCount(),
      executionQueue.getActiveCount(),
      executionQueue.getDelayedCount(),
      executionQueue.getFailedCount(),
      executionQueue.getCompletedCount(),
    ]);

    res.json({
      queue: 'executions',
      counts: { waiting, active, delayed, failed, completed },
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    logger.error({ err }, 'Failed to fetch queue stats');
    res.status(503).json({
      error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'Failed to fetch queue stats' },
    });
  }
}
