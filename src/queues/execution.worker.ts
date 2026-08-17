import { Worker, type Job } from 'bullmq';
import { env } from '../config/env.js';
import { logger } from '../common/logger/logger.js';
import { agentRunnerService, ExecutionCancelledError } from '../modules/agents/agent-runner.service.js';
import { ApprovalRequiredError } from '../modules/workflows/nodes/act.node.js';
import { EXECUTION_QUEUE, type ExecutionJobData } from './queue.js';

// ─── Execution Worker ─────────────────────────────────────────────────────────
//
// Retry policy: 3 attempts, exponential backoff 2s → 4s → 8s.
// Non-retryable errors (cancellation, approval pause) are logged and dropped.
// Concurrency: 2 jobs per process.

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
      lockDuration: 300_000,
      lockRenewTime: 60_000,
    },
  );

  // ── Events ────────────────────────────────────────────────────────────────

  worker.on('completed', (job) => {
    logger.info({ executionId: job.data.executionId, jobId: job.id }, 'Worker: job completed');
  });

  worker.on('failed', (job, err) => {
    if (!job) return;

    const isCancelled = err instanceof ExecutionCancelledError;
    const isPaused   = err instanceof ApprovalRequiredError;
    const isFinal    = job.attemptsMade >= (job.opts.attempts ?? 3);

    if (isCancelled) {
      logger.info(
        { executionId: job.data.executionId },
        'Worker: job cancelled — not retrying',
      );
    } else if (isPaused) {
      logger.info(
        { executionId: job.data.executionId, approvalId: err.approvalId },
        'Worker: job paused for approval — released',
      );
    } else if (isFinal) {
      logger.error(
        { err, executionId: job.data.executionId, attempts: job.attemptsMade },
        'Worker: job exhausted all retries',
      );
    } else {
      logger.warn(
        { err, executionId: job.data.executionId, attempt: job.attemptsMade },
        'Worker: job failed — will retry',
      );
    }
  });

  worker.on('error', (err) => {
    logger.error({ err }, 'Worker: unexpected error');
  });

  worker.on('stalled', (jobId) => {
    logger.warn({ jobId }, 'Worker: job stalled — BullMQ will re-queue');
  });

  return worker;
}
