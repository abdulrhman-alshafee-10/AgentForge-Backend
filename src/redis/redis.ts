// ─── Redis clients ────────────────────────────────────────────────────────────
import Redis from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../common/logger/logger.js';

const redisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: false,
} as const;

export const redis = new Redis(env.REDIS_URL, redisOptions);
redis.on('error', (err) => logger.error(err, 'Redis error'));
redis.on('connect', () => logger.info('Redis connected'));

/** Creates a dedicated pub/sub subscriber connection. Each SSE stream owns one. */
export function createRedisSubscriber(): Redis {
  const sub = new Redis(env.REDIS_URL, redisOptions);
  sub.on('error', (err) => logger.error(err, 'Redis subscriber error'));
  return sub;
}
