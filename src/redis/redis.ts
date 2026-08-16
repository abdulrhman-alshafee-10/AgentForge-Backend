import Redis from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../common/logger/logger.js';

// Standard client for normal operations (e.g., rate limiting, pub, state)
export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

redis.on('error', (err) => {
  logger.error(err, 'Redis connection error');
});

// Dedicated client for pub/sub (subscribing blocks the connection)
export const redisSubscriber = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

redisSubscriber.on('error', (err) => {
  logger.error(err, 'Redis subscriber connection error');
});
