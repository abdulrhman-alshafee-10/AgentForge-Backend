import { PrismaClient } from '@prisma/client';
import { logger } from '../common/logger/logger.js';

// ─── Prisma singleton ─────────────────────────────────────────────────────────
//
// One PrismaClient instance for the whole process. Exported for use in
// repositories and the health check. Closed on graceful shutdown in server.ts.
//
// In Prisma 6 the `url` is no longer read from schema.prisma — we pass it
// explicitly via `datasources`. The migrate URL lives in prisma.config.ts.
// $use middleware was removed in Prisma 6; slow-query logging uses a client
// extension instead.

function buildPrismaClient(): PrismaClient {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    process.stderr.write('\n❌  AgentForge — DATABASE_URL is not set\n\n');
    process.exit(1);
  }

  const base = new PrismaClient({
    datasources: { db: { url: dbUrl } },
  });

  // ── Slow-query logging via Prisma Client Extension ────────────────────────
  const client = base.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const before = Date.now();
          const result = await query(args);
          const duration = Date.now() - before;

          if (duration > 50) {
            logger.warn({ model, operation, duration }, 'Slow Prisma query');
          } else {
            logger.debug({ model, operation, duration }, 'Prisma query');
          }

          return result;
        },
      },
    },
  });

  // The extended client is compatible with PrismaClient for all practical use.
  return client as unknown as PrismaClient;
}

export const prisma: PrismaClient = buildPrismaClient();
