import Redis from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../common/logger/logger.js';

// ─── Shared options ───────────────────────────────────────────────────────────

const redisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: false,
} as const;

// ─── Standard client ──────────────────────────────────────────────────────────
// Used for normal operations: set/get, pub, rate-limiting, etc.

export const redis = new Redis(env.REDIS_URL, redisOptions);

redis.on('error', (err) => {
  logger.error(err, 'Redis connection error');
});

redis.on('connect', () => {
  logger.info('Redis connected');
});

// ─── Subscriber factory ───────────────────────────────────────────────────────
// ioredis requires a *dedicated* connection per subscription group because
// a subscribed connection cannot issue regular commands.
//
// We create one per SSE request so each stream owns its own connection and can
// cleanly unsubscribe + quit on disconnect without affecting others.

export function createRedisSubscriber(): Redis {
  const sub = new Redis(env.REDIS_URL, redisOptions);

  sub.on('error', (err) => {
    logger.error(err, 'Redis subscriber connection error');
  });

  return sub;
}

