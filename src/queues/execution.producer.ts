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
