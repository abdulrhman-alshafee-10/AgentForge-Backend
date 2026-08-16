import { PrismaClient, Prisma } from '@prisma/client';
import { logger } from '../common/logger/logger.js';

// ─── Prisma singleton ─────────────────────────────────────────────────────────
//
// One PrismaClient instance for the whole process. Exported for use in
// repositories and the health check. Closed on graceful shutdown in server.ts.

function buildPrismaClient(): PrismaClient {
  const client = new PrismaClient({
    log: [
      { level: 'query', emit: 'event' },
      { level: 'warn',  emit: 'event' },
      { level: 'error', emit: 'event' },
    ],
  });

  // ── Query logging ──────────────────────────────────────────────────────────
  // Log slow queries (>50 ms) so they show up in our structured logs.
  client.$on('query', (e: Prisma.QueryEvent) => {
    if (e.duration > 50) {
      logger.warn(
        { query: e.query, params: e.params, duration: e.duration },
        'Slow Prisma query',
      );
    } else {
      logger.debug(
        { query: e.query, duration: e.duration },
        'Prisma query',
      );
    }
  });

  client.$on('warn', (e: Prisma.LogEvent) => {
    logger.warn({ message: e.message }, 'Prisma warning');
  });

  client.$on('error', (e: Prisma.LogEvent) => {
    logger.error({ message: e.message }, 'Prisma error');
  });

  return client;
}

export const prisma: PrismaClient = buildPrismaClient();
