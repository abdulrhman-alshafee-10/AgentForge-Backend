import type { Request, Response, NextFunction, RequestHandler } from 'express';

// ─── Async route handler wrapper ──────────────────────────────────────────────
//
// Express 4 does not catch rejected promises in route handlers.
// Wrap every async handler with this helper so unhandled rejections are
// forwarded to the global error-handling middleware via `next(err)`.
//
// Usage:
//   router.get('/path', wrap(async (req, res) => { ... }));
//
// Note: Express 5 handles this automatically. Once the project upgrades,
// this wrapper can be removed.

export function wrap(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return function asyncWrapper(req, res, next): void {
    fn(req, res, next).catch(next);
  };
}
