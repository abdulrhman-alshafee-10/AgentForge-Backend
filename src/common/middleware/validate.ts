import type { Request, Response, NextFunction } from 'express';
import { type ZodTypeAny, type z } from 'zod';

// ─── Zod validation middleware ────────────────────────────────────────────────
//
// Usage:
//
//   router.post('/chats', validate({ body: CreateChatSchema }), controller.create);
//
// If validation fails the Zod error is forwarded to the global error handler,
// which formats it as a VALIDATION_ERROR envelope.
//
// On success the validated (and coerced) values are written back to req so
// downstream handlers get typed, clean data.

interface ValidateOptions {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

export function validate(schemas: ValidateOptions) {
  return function validateMiddleware(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): void {
    try {
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      if (schemas.query) {
        // query values arrive as strings; schemas should use z.coerce where needed
        req.query = schemas.query.parse(req.query) as typeof req.query;
      }
      if (schemas.params) {
        req.params = schemas.params.parse(req.params) as typeof req.params;
      }
      next();
    } catch (err) {
      // Forward to the global error handler (handles ZodError)
      next(err);
    }
  };
}

// ─── Convenience type helper ──────────────────────────────────────────────────
// Derive the inferred type from a Zod schema in controller signatures:
//   type CreateChatBody = Infer<typeof CreateChatSchema>

export type Infer<T extends ZodTypeAny> = z.infer<T>;
