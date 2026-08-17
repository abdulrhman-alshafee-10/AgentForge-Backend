// ─── Zod validation middleware ────────────────────────────────────────────────
import type { Request, Response, NextFunction } from 'express';
import { type ZodTypeAny, type z } from 'zod';

interface ValidateOptions {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

/** Validates and coerces req.body / req.query / req.params against Zod schemas. */
export function validate(schemas: ValidateOptions) {
  return function validateMiddleware(req: Request, _res: Response, next: NextFunction): void {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body);
      if (schemas.query) req.query = schemas.query.parse(req.query) as typeof req.query;
      if (schemas.params) req.params = schemas.params.parse(req.params) as typeof req.params;
      next();
    } catch (err) {
      next(err);
    }
  };
}

export type Infer<T extends ZodTypeAny> = z.infer<T>;
