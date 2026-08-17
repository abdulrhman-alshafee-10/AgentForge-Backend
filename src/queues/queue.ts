// ─── BullMQ execution queue ───────────────────────────────────────────────────
import { Queue } from 'bullmq';
import { env } from '../config/env.js';
import { logger } from '../common/logger/logger.js';

export interface ExecutionJobData {
  executionId: string;
  tenantId: string;
  attempt: number;
}

export const EXECUTION_QUEUE = 'executions';

export const executionQueue = new Queue<ExecutionJobData>(EXECUTION_QUEUE, {
  connection: { url: env.REDIS_URL },
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2_000 },
    removeOnComplete: { age: 3_600 },
    removeOnFail: { age: 86_400 },
  },
});

executionQueue.on('error', (err) => logger.error({ err }, 'ExecutionQueue error'));
