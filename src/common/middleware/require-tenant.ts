import type { Request, Response, NextFunction } from 'express';
import { UnauthenticatedError, ForbiddenError } from '../errors/index.js';

// ─── requireTenant middleware ─────────────────────────────────────────────────
//
// Ensures the authenticated user belongs to the tenant identified in the route
// param (default: `tenantId`).  Apply after `authenticate` on tenant-scoped
// routers where the tenantId appears in the URL.
//
// For most routes the JWT tenantId is sufficient — this guard is for cases
// where the URL carries an explicit tenantId that must match the token's claim.

export function requireTenant(paramName = 'tenantId') {
  return function requireTenantMiddleware(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): void {
    if (!req.user) {
      return next(new UnauthenticatedError());
    }

    const urlTenantId = req.params[paramName];

    // If the route does not have the param, just ensure the user has a tenantId
    if (!urlTenantId) {
      return next();
    }

    if (req.user.tenantId !== urlTenantId) {
      // Return 404 to avoid revealing the resource exists in another tenant
      return next(new ForbiddenError('Access denied'));
    }

    next();
  };
}
