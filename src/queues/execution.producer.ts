// ─── Execution job producer ───────────────────────────────────────────────────
import { executionQueue, type ExecutionJobData } from './queue.js';
import { logger } from '../common/logger/logger.js';

/** Enqueues a fresh execution. jobId = executionId prevents double-enqueue. */
export async function enqueueExecution(executionId: string, tenantId: string): Promise<void> {
  await executionQueue.add('run' as any, { executionId, tenantId, attempt: 1 }, { jobId: executionId });
  logger.info({ executionId, tenantId }, 'Execution enqueued');
}

/**
 * Enqueues a resume job after an approval decision or expiry.
 * Uses a timestamped jobId so BullMQ dedup doesn't block multiple resumes.
 */
export async function enqueueResume(executionId: string, tenantId: string): Promise<void> {
  const jobId = `${executionId}:resume:${Date.now()}`;
  await executionQueue.add('run' as any, { executionId, tenantId, attempt: 1 }, { jobId });
  logger.info({ executionId, tenantId, jobId }, 'Execution resume enqueued');
}
