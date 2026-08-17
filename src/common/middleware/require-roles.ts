// ─── Role guard middleware ────────────────────────────────────────────────────
import type { Request, Response, NextFunction } from 'express';
import { ForbiddenError, UnauthenticatedError } from '../errors/index.js';
import type { UserRole } from '../../modules/auth/auth.types.js';

/** Rejects the request if req.user.role is not in the allowed list. */
export function requireRoles(roles: UserRole[]) {
  return function (req: Request, _res: Response, next: NextFunction): void {
    if (!req.user) return next(new UnauthenticatedError());
    if (!roles.includes(req.user.role)) return next(new ForbiddenError('Insufficient role'));
    next();
  };
}
