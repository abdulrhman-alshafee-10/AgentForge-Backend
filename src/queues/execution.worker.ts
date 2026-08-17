import { Worker, type Job } from 'bullmq';
import { env } from '../config/env.js';
import { logger } from '../common/logger/logger.js';
import { agentRunnerService, ExecutionCancelledError } from '../modules/agents/agent-runner.service.js';
import { EXECUTION_QUEUE, type ExecutionJobData } from './queue.js';

// ─── Execution Worker ─────────────────────────────────────────────────────────
//
// Processes jobs from the `executions` queue.
//
// Retry policy (inherited from queue defaults):
//   - 3 attempts, exponential backoff: 2s → 4s → 8s
//   - Cancellation errors skip retries immediately (moveToFailed directly)
//
// Concurrency: 2 jobs per worker process.  Scale horizontally by running
// more worker processes — BullMQ handles distributed locking via Redis.

export function createExecutionWorker(): Worker<ExecutionJobData> {
  const worker = new Worker<ExecutionJobData>(
    EXECUTION_QUEUE,
    async (job: Job<ExecutionJobData>) => {
      const { executionId, tenantId } = job.data;

      logger.info(
        { executionId, tenantId, attempt: job.attemptsMade + 1 },
        'Worker: processing execution job',
      );

      await agentRunnerService.run(executionId);
    },
    {
      connection: { url: env.REDIS_URL },
      concurrency: 2,
      // Lock the job for up to 5 minutes; renew automatically while running
      lockDuration: 300_000,
      // How often to extend the lock
      lockRenewTime: 60_000,
    },
  );

  // ── Events ────────────────────────────────────────────────────────────────

  worker.on('completed', (job) => {
    logger.info(
      { executionId: job.data.executionId, jobId: job.id },
      'Worker: job completed',
    );
  });

  worker.on('failed', (job, err) => {
    if (!job) return;

    const isCancelled = err instanceof ExecutionCancelledError;
    const isFinalAttempt = job.attemptsMade >= (job.opts.attempts ?? 3);

    if (isCancelled) {
      // Cancellation is intentional — don't log as an error
      logger.info(
        { executionId: job.data.executionId },
        'Worker: job cancelled by user request',
      );
    } else if (isFinalAttempt) {
      logger.error(
        { err, executionId: job.data.executionId, attempts: job.attemptsMade },
        'Worker: job exhausted all retry attempts',
      );
    } else {
      logger.warn(
        { err, executionId: job.data.executionId, attempt: job.attemptsMade },
        'Worker: job failed — will retry',
      );
    }
  });

  worker.on('error', (err) => {
    logger.error({ err }, 'Worker: unexpected worker error');
  });

  worker.on('stalled', (jobId) => {
    logger.warn({ jobId }, 'Worker: job stalled — will be re-queued by BullMQ');
  });

  return worker;
}
