// ─── Redis sliding-window rate limiter ───────────────────────────────────────
import type { Request, Response, NextFunction } from 'express';
import { redis } from '../../redis/redis.js';
import { env } from '../../config/env.js';
import { RateLimitedError } from '../errors/HttpErrors.js';

export interface RateLimitOptions {
  windowMs?: number;
  max?: number;
  scope: string;
  identity?: (req: Request) => string;
}

/** Per-identity sliding-window limiter backed by a Redis sorted set. Fails open on Redis errors. */
export function redisRateLimit(options: RateLimitOptions) {
  const {
    windowMs = env.RATE_LIMIT_WINDOW_MS,
    max = env.RATE_LIMIT_API_MAX,
    scope,
    identity = (req) => req.user?.id ?? req.ip ?? 'anonymous',
  } = options;

  return async function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    const key = `ratelimit:${scope}:${identity(req)}`;
    const now = Date.now();

    try {
      const pipeline = redis.pipeline();
      pipeline.zremrangebyscore(key, '-inf', now - windowMs);
      pipeline.zadd(key, now, `${now}:${Math.random()}`);
      pipeline.zcard(key);
      pipeline.pexpire(key, windowMs);
      const results = await pipeline.exec();
      const count = (results?.[2]?.[1] as number) ?? 0;

      res.setHeader('X-RateLimit-Limit', max);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, max - count));
      res.setHeader('X-RateLimit-Reset', Math.ceil((now + windowMs) / 1000));

      if (count > max) return next(new RateLimitedError('Rate limit exceeded'));
      next();
    } catch {
      next(); // fail open
    }
  };
}
