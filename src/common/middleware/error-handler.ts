// ─── Global error handler ─────────────────────────────────────────────────────
import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError, ValidationError } from '../errors/index.js';
import { logger } from '../logger/logger.js';

interface ErrorEnvelope {
  error: { code: string; message: string; details?: unknown };
}

function envelope(code: string, message: string, details?: unknown): ErrorEnvelope {
  return { error: { code, message, ...(details !== undefined ? { details } : {}) } };
}

export function errorHandler() {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return function errorHandlerMiddleware(err: unknown, req: Request, res: Response, _next: NextFunction): void {
    if (err instanceof ZodError) {
      const details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
      res.status(400).json(envelope('VALIDATION_ERROR', 'Validation failed', details));
      return;
    }

    if (err instanceof AppError && err.isOperational) {
      if (err.statusCode >= 500) logger.error({ correlationId: req.correlationId, err }, 'Operational error');
      res.status(err.statusCode).json(envelope(err.code, err.message, err.details));
      return;
    }

    logger.error({ correlationId: req.correlationId, err }, 'Unexpected error');
    res.status(500).json(envelope('INTERNAL_ERROR', 'An unexpected error occurred'));
  };
}
