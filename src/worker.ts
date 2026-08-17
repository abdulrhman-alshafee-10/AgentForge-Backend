import { logger } from './common/logger/logger.js';
import { prisma } from './db/prisma.js';
import { redis } from './redis/redis.js';
import { env } from './config/env.js';
import { registerTools } from './modules/tools/tools.register.js';
import { createExecutionWorker } from './queues/execution.worker.js';

// ─── Worker entry point ───────────────────────────────────────────────────────
//
// Boots only what the worker needs:
//   - Prisma (for DB reads/writes during execution)
//   - Redis (for SSE pub/sub, cancellation flags, and BullMQ itself)
//   - Tool registry (tools are invoked inside the LangGraph nodes)
//   - BullMQ Worker (consumes jobs from the `executions` queue)
//
// Deliberately does NOT start an HTTP server.
//
// Run:  npm run worker
// Dev:  tsx watch src/worker.ts

// ── Register tools ────────────────────────────────────────────────────────────
registerTools();

// ── Start the BullMQ worker ───────────────────────────────────────────────────
const worker = createExecutionWorker();

logger.info(
  { concurrency: 2, queue: 'executions', env: env.NODE_ENV },
  'AgentForge worker started',
);

// ─── Graceful shutdown ────────────────────────────────────────────────────────
//
// On SIGTERM / SIGINT:
//   1. Stop accepting new jobs (worker.close()).
//   2. Wait for the currently running job to finish (BullMQ handles this).
//   3. Close Prisma and Redis connections.

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Worker: shutdown signal received');

  try {
    // Stop accepting new jobs; wait for current job to finish (up to 30 s)
    await worker.close();
    logger.info('Worker: BullMQ worker closed');

    await prisma.$disconnect();
    logger.info('Worker: Prisma disconnected');

    await redis.quit();
    logger.info('Worker: Redis disconnected');

    logger.info('Worker: shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'Worker: error during shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'Worker: unhandled promise rejection — exiting');
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Worker: uncaught exception — exiting');
  process.exit(1);
});
