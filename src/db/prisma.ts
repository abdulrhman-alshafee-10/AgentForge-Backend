// ─── Prisma singleton ─────────────────────────────────────────────────────────
import { PrismaClient } from '@prisma/client';
import { logger } from '../common/logger/logger.js';

function buildPrismaClient(): PrismaClient {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    process.stderr.write('\n❌  DATABASE_URL is not set\n\n');
    process.exit(1);
  }

  const base = new PrismaClient({ datasources: { db: { url: dbUrl } } });

  return base.$extends({
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
  }) as unknown as PrismaClient;
}

export const prisma: PrismaClient = buildPrismaClient();
