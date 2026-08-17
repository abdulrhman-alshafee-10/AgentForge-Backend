// ─── Worker process entry point ───────────────────────────────────────────────
import { logger } from './common/logger/logger.js';
import { prisma } from './db/prisma.js';
import { redis } from './redis/redis.js';
import { env } from './config/env.js';
import { registerTools } from './modules/tools/tools.register.js';
import { createExecutionWorker } from './queues/execution.worker.js';
import { approvalService } from './modules/approvals/approval.service.js';

registerTools();

const worker = createExecutionWorker();

logger.info({ concurrency: 2, queue: 'executions', env: env.NODE_ENV }, 'Worker started');

// Expire stale PENDING approvals every 60 s and re-queue their executions.
const expirySweeper = setInterval(async () => {
  try {
    await approvalService.expireStale();
  } catch (err) {
    logger.error({ err }, 'Approval expiry sweep failed');
  }
}, 60_000);

// ─── Graceful shutdown ────────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Worker shutdown signal received');
  clearInterval(expirySweeper);
  try {
    await worker.close();
    await prisma.$disconnect();
    await redis.quit();
    logger.info('Worker shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'Worker shutdown error');
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'Unhandled promise rejection');
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  process.exit(1);
});
