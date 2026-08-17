// ─── Tenant guard middleware ──────────────────────────────────────────────────
import type { Request, Response, NextFunction } from 'express';
import { UnauthenticatedError, ForbiddenError } from '../errors/index.js';

/**
 * When a route URL carries an explicit tenantId param, asserts it matches
 * the JWT's tenantId. If the param is absent, the JWT tenantId alone is sufficient.
 */
export function requireTenant(paramName = 'tenantId') {
  return function (req: Request, _res: Response, next: NextFunction): void {
    if (!req.user) return next(new UnauthenticatedError());
    const urlTenantId = req.params[paramName];
    if (urlTenantId && req.user.tenantId !== urlTenantId) {
      return next(new ForbiddenError('Access denied'));
    }
    next();
  };
}
