// ─── BullMQ execution worker ──────────────────────────────────────────────────
import { Worker, type Job } from 'bullmq';
import { env } from '../config/env.js';
import { logger } from '../common/logger/logger.js';
import { agentRunnerService, ExecutionCancelledError } from '../modules/agents/agent-runner.service.js';
import { ApprovalRequiredError } from '../modules/workflows/nodes/act.node.js';
import { EXECUTION_QUEUE, type ExecutionJobData } from './queue.js';

export function createExecutionWorker(): Worker<ExecutionJobData> {
  const worker = new Worker<ExecutionJobData>(
    EXECUTION_QUEUE,
    async (job: Job<ExecutionJobData>) => {
      const { executionId, tenantId } = job.data;
      logger.info({ executionId, tenantId, attempt: job.attemptsMade + 1 }, 'Worker: processing job');
      await agentRunnerService.run(executionId);
    },
    {
      connection: { url: env.REDIS_URL },
      concurrency: 2,
      lockDuration: 300_000,
      lockRenewTime: 60_000,
    },
  );

  worker.on('completed', (job) => {
    logger.info({ executionId: job.data.executionId }, 'Worker: job completed');
  });

  worker.on('failed', (job, err) => {
    if (!job) return;
    const isFinal = job.attemptsMade >= (job.opts.attempts ?? 3);

    if (err instanceof ExecutionCancelledError) {
      logger.info({ executionId: job.data.executionId }, 'Worker: job cancelled');
    } else if (err instanceof ApprovalRequiredError) {
      logger.info({ executionId: job.data.executionId, approvalId: err.approvalId }, 'Worker: job paused for approval');
    } else if (isFinal) {
      logger.error({ err, executionId: job.data.executionId }, 'Worker: job exhausted retries');
    } else {
      logger.warn({ err, executionId: job.data.executionId, attempt: job.attemptsMade }, 'Worker: job failed — will retry');
    }
  });

  worker.on('error', (err) => logger.error({ err }, 'Worker: unexpected error'));
  worker.on('stalled', (jobId) => logger.warn({ jobId }, 'Worker: job stalled'));

  return worker;
}
