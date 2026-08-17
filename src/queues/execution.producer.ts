import { executionQueue, type ExecutionJobData } from './queue.js';
import { logger } from '../common/logger/logger.js';

// ─── Execution Producer ───────────────────────────────────────────────────────
//
// Called by MessagesService immediately after the Execution row is created.
// The job ID is the executionId itself so BullMQ's deduplication prevents
// double-enqueuing the same execution (idempotent enqueue).

export async function enqueueExecution(
  executionId: string,
  tenantId: string,
): Promise<void> {
  const jobData: ExecutionJobData = {
    executionId,
    tenantId,
    attempt: 1,
  };

  await executionQueue.add(
    'run' as any,
    jobData,
    { jobId: executionId },
  );

  logger.info({ executionId, tenantId }, 'Execution enqueued');
}

// ─── Resume producer ──────────────────────────────────────────────────────────
//
// Called after an approval decision or expiry to restart a paused execution.
// Uses a different jobId suffix so it doesn't collide with the original job
// (which BullMQ may have already removed from the active set).

export async function enqueueResume(
  executionId: string,
  tenantId: string,
): Promise<void> {
  const jobData: ExecutionJobData = {
    executionId,
    tenantId,
    attempt: 1,
  };

  // Use a timestamp suffix to allow multiple resumes (e.g. re-approval after expiry).
  const jobId = `${executionId}:resume:${Date.now()}`;

  await executionQueue.add('run' as any, jobData, { jobId });

  logger.info({ executionId, tenantId, jobId }, 'Execution resume enqueued');
}
