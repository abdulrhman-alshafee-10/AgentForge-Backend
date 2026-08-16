import type { Request, Response, NextFunction } from 'express';
import { ForbiddenError, UnauthenticatedError } from '../errors/index.js';
import type { UserRole } from '../../modules/auth/auth.types.js';

// ─── requireRoles middleware ──────────────────────────────────────────────────
//
// Usage:
//   router.delete('/:id', requireRoles(['owner']), controller.delete);
//
// Must be placed AFTER the `authenticate` middleware in the chain.

export function requireRoles(roles: UserRole[]) {
  return function requireRolesMiddleware(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): void {
    if (!req.user) {
      return next(new UnauthenticatedError());
    }

    if (!roles.includes(req.user.role)) {
      return next(new ForbiddenError('Insufficient role'));
    }

    next();
  };
}
