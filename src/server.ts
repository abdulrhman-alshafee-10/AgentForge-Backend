import http from 'http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './common/logger/logger.js';
import { prisma } from './db/prisma.js';

// ─── Server entry point ───────────────────────────────────────────────────────
//
// Responsibilities:
//   1. Create the Express app.
//   2. Bind it to a port.
//   3. Handle SIGTERM / SIGINT for graceful shutdown.
//
// Graceful shutdown sequence:
//   a. Stop accepting new connections (server.close).
//   b. Wait up to SHUTDOWN_TIMEOUT_MS for in-flight requests to finish.
//   c. Exit 0 on clean drain; exit 1 on timeout.
//
// The app itself (createApp) is kept in app.ts so tests can import it
// without binding a port.

const app = createApp();
const server = http.createServer(app);

server.listen(env.PORT, () => {
  logger.info(
    { port: env.PORT, env: env.NODE_ENV },
    `AgentForge API listening on port ${env.PORT}`,
  );
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────

function shutdown(signal: string): void {
  logger.info({ signal }, 'Shutdown signal received — draining connections');

  server.close((err) => {
    if (err) {
      logger.error({ err }, 'Error during server close');
      process.exit(1);
    }

    // Disconnect Prisma before exiting
    prisma.$disconnect().then(() => {
      logger.info('Prisma disconnected');
      logger.info('Server closed cleanly');
      process.exit(0);
    }).catch((disconnectErr: unknown) => {
      logger.error({ err: disconnectErr }, 'Error disconnecting Prisma');
      process.exit(1);
    });
  });

  // Force-exit if connections are not drained in time
  setTimeout(() => {
    logger.warn(
      { timeoutMs: env.SHUTDOWN_TIMEOUT_MS },
      'Shutdown timeout exceeded — forcing exit',
    );
    process.exit(1);
  }, env.SHUTDOWN_TIMEOUT_MS).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ─── Unhandled rejections / exceptions ───────────────────────────────────────
//
// These are programming bugs, not operational errors. Log and exit so the
// process manager (Docker, PM2, Kubernetes) can restart cleanly.

process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'Unhandled promise rejection — exiting');
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception — exiting');
  process.exit(1);
});
