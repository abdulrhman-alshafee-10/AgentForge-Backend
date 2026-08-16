import type { AuthUser } from '../../modules/auth/auth.types.js';

// ─── Express Request augmentation ────────────────────────────────────────────
//
// Adds `user` and `correlationId` to the Express Request interface so every
// handler can access them without casting.

declare global {
  namespace Express {
    interface Request {
      /** Set by the authenticate middleware after validating the JWT. */
      user?: AuthUser;
      /** Set by the correlation-id middleware on every request. */
      correlationId: string;
    }
  }
}

export {};
