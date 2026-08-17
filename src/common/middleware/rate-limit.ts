import type { Request, Response, NextFunction } from 'express';
import { redis } from '../../redis/redis.js';
import { env } from '../../config/env.js';
import { RateLimitedError } from '../errors/HttpErrors.js';

// ─── Redis-backed sliding-window rate limiter ─────────────────────────────────
//
// Uses a Redis sorted set per identity key.  Each request adds a member with
// the current timestamp.  Members older than the window are trimmed, and if the
// set size exceeds the limit the request is rejected.
//
// Key structure: `ratelimit:<scope>:<identity>`
//
// This is a true sliding window — fairer than fixed windows but slightly more
// expensive (2-3 Redis calls per request in the hot path).

export interface RateLimitOptions {
  /** Window size in milliseconds */
  windowMs?: number;
  /** Maximum requests allowed in the window */
  max?: number;
  /** Key scope — used to create distinct limits per endpoint group */
  scope: string;
  /**
   * Function that returns the identity to rate-limit against.
   * Defaults to req.user?.id if authenticated, otherwise req.ip.
   */
  identity?: (req: Request) => string;
}

export function redisRateLimit(options: RateLimitOptions) {
  const {
    windowMs = env.RATE_LIMIT_WINDOW_MS,
    max = env.RATE_LIMIT_API_MAX,
    scope,
    identity = defaultIdentity,
  } = options;

  return async function rateLimitMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const id = identity(req);
    const key = `ratelimit:${scope}:${id}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    try {
      const pipeline = redis.pipeline();
      // Remove expired entries
      pipeline.zremrangebyscore(key, '-inf', windowStart);
      // Add current request (score = timestamp, member = timestamp:random)
      pipeline.zadd(key, now, `${now}:${Math.random()}`);
      // Count requests in window
      pipeline.zcard(key);
      // Set TTL so idle keys expire
      pipeline.pexpire(key, windowMs);

      const results = await pipeline.exec();
      const count = (results?.[2]?.[1] as number) ?? 0;

      // Add rate limit headers
      res.setHeader('X-RateLimit-Limit', max);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, max - count));
      res.setHeader('X-RateLimit-Reset', Math.ceil((now + windowMs) / 1000));

      if (count > max) {
        next(new RateLimitedError('Rate limit exceeded'));
        return;
      }

      next();
    } catch {
      // Redis failure — fail open to avoid blocking traffic
      next();
    }
  };
}

function defaultIdentity(req: Request): string {
  return req.user?.id ?? req.ip ?? 'anonymous';
}
