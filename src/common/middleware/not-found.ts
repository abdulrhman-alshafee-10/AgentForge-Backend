import type { Request, Response } from 'express';

// ─── 404 catch-all ────────────────────────────────────────────────────────────
//
// Registered after all real routes. Returns the standard error envelope
// so clients get a consistent shape for missing routes.

export function notFound() {
  return function notFoundMiddleware(req: Request, res: Response): void {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: `Route ${req.method} ${req.path} not found`,
      },
    });
  };
}
