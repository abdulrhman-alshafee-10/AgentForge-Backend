// ─── Async route handler wrapper ─────────────────────────────────────────────
import type { Request, Response, NextFunction, RequestHandler } from 'express';

/** Forwards rejected async handlers to Express error middleware (Express 4 compat). */
export function wrap(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next): void => {
    fn(req, res, next).catch(next);
  };
}
