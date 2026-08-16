import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

declare global {
  // Augment Express Request so all downstream code can read req.correlationId
  namespace Express {
    interface Request {
      correlationId: string;
    }
  }
}

// ─── Correlation-ID middleware ────────────────────────────────────────────────
//
// Reads the incoming `x-correlation-id` header if present; otherwise generates
// a new UUID v4. Attaches it to `req.correlationId` and echoes it back in the
// response header so clients can correlate logs.

export function correlationId() {
  return function correlationIdMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const incoming = req.headers['x-correlation-id'];
    const id =
      typeof incoming === 'string' && incoming.length > 0
        ? incoming
        : randomUUID();

    req.correlationId = id;
    res.setHeader('x-correlation-id', id);

    next();
  };
}
