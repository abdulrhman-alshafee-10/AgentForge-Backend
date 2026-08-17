// ─── API server entry point ───────────────────────────────────────────────────
import http from 'http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './common/logger/logger.js';
import { prisma } from './db/prisma.js';
import { redis } from './redis/redis.js';
import { registerTools } from './modules/tools/tools.register.js';
import { executionQueue } from './queues/queue.js';

const app = createApp();
const server = http.createServer(app);

registerTools();

server.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'AgentForge API listening');
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────

function shutdown(signal: string): void {
  logger.info({ signal }, 'Shutdown signal — draining connections');

  server.close((err) => {
    if (err) {
      logger.error({ err }, 'Error during server close');
      process.exit(1);
    }

    prisma.$disconnect()
      .then(() => executionQueue.close())
      .then(() => redis.quit())
      .then(() => {
        logger.info('Server closed cleanly');
        process.exit(0);
      })
      .catch((disconnectErr: unknown) => {
        logger.error({ err: disconnectErr }, 'Shutdown cleanup error');
        process.exit(1);
      });
  });

  setTimeout(() => {
    logger.warn({ timeoutMs: env.SHUTDOWN_TIMEOUT_MS }, 'Shutdown timeout — forcing exit');
    process.exit(1);
  }, env.SHUTDOWN_TIMEOUT_MS).unref();
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
