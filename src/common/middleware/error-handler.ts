import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError, ValidationError } from '../errors/index.js';
import { logger } from '../logger/logger.js';

// ─── Error response envelope ──────────────────────────────────────────────────
//
// Every error from this API has the same shape:
//
//   { error: { code, message, details? } }
//
// This matches the contract defined in docs/api.md.

interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

function buildEnvelope(
  code: string,
  message: string,
  details?: unknown,
): ErrorEnvelope {
  return { error: { code, message, ...(details !== undefined ? { details } : {}) } };
}

// ─── Global error-handling middleware ─────────────────────────────────────────
//
// Must be registered LAST in the Express chain (after all routes).
// Signature must have all 4 parameters so Express recognises it as an
// error handler.

export function errorHandler() {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return function errorHandlerMiddleware(
    err: unknown,
    req: Request,
    res: Response,
    _next: NextFunction,
  ): void {
    // ── Zod validation errors ──────────────────────────────────────────────
    if (err instanceof ZodError) {
      const details = err.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      res
        .status(400)
        .json(buildEnvelope('VALIDATION_ERROR', 'Validation failed', details));
      return;
    }

    // ── Known operational errors ───────────────────────────────────────────
    if (err instanceof AppError && err.isOperational) {
      if (err.statusCode >= 500) {
        logger.error(
          { correlationId: req.correlationId, err },
          'Operational server error',
        );
      }
      res
        .status(err.statusCode)
        .json(buildEnvelope(err.code, err.message, err.details));
      return;
    }

    // ── Unknown / unexpected errors ────────────────────────────────────────
    logger.error(
      { correlationId: req.correlationId, err },
      'Unexpected error',
    );

    res.status(500).json(buildEnvelope('INTERNAL_ERROR', 'An unexpected error occurred'));
  };
}
