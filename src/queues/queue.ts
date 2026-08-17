import { Queue } from 'bullmq';
import { env } from '../config/env.js';
import { logger } from '../common/logger/logger.js';

// ─── Job data shape ───────────────────────────────────────────────────────────

export interface ExecutionJobData {
  executionId: string;
  tenantId: string;
  /** Attempt number tracked on our side for observability (BullMQ tracks its own) */
  attempt: number;
}

// ─── Queue name ───────────────────────────────────────────────────────────────

export const EXECUTION_QUEUE = 'executions';

// ─── Queue singleton ──────────────────────────────────────────────────────────
//
// The Queue instance is only used by producers (API server).
// Workers create their own Worker instance pointing at the same queue name.
// Both share the same Redis connection string.

export const executionQueue = new Queue<ExecutionJobData>(EXECUTION_QUEUE, {
  connection: { url: env.REDIS_URL },
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2_000, // 2s, 4s, 8s
    },
    // Remove completed jobs after 1 hour; keep failed jobs for 24 hours
    removeOnComplete: { age: 3_600 },
    removeOnFail: { age: 86_400 },
  },
});

executionQueue.on('error', (err) => {
  logger.error({ err }, 'ExecutionQueue error');
});
