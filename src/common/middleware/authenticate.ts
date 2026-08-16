import { AsyncLocalStorage } from 'async_hooks';
import type { Request, Response, NextFunction } from 'express';
import { UnauthenticatedError } from '../errors/index.js';
import { tokenService } from '../../modules/auth/token.service.js';
import type { AuthUser } from '../../modules/auth/auth.types.js';

// ─── Tenant AsyncLocalStorage ─────────────────────────────────────────────────
//
// Repositories and services can call `getTenantContext()` to read the current
// request's tenant without prop-drilling.  Services should prefer explicit
// parameters; this is a convenience escape hatch.

export interface TenantALS {
  userId: string;
  tenantId: string;
  role: AuthUser['role'];
}

export const tenantALS = new AsyncLocalStorage<TenantALS>();

export function getTenantContext(): TenantALS | undefined {
  return tenantALS.getStore();
}

// ─── authenticate middleware ──────────────────────────────────────────────────
//
// Reads the Bearer token from `Authorization`, verifies it, attaches `req.user`,
// and runs the rest of the request inside `tenantALS.run(...)` so the ALS store
// is available downstream.
//
// Public routes are handled by an allow-list in app.ts — this middleware is
// applied globally to /api/v1/* after that allow-list check.

export function authenticate() {
  return function authenticateMiddleware(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): void {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return next(new UnauthenticatedError());
    }

    const token = authHeader.slice(7);

    try {
      const payload = tokenService.verifyAccessToken(token);

      const user: AuthUser = {
        id: payload.sub,
        tenantId: payload.tenantId,
        email: payload.email,
        role: payload.role,
      };

      req.user = user;

      // Run the rest of the request inside the ALS context
      tenantALS.run(
        { userId: user.id, tenantId: user.tenantId, role: user.role },
        next,
      );
    } catch {
      next(new UnauthenticatedError());
    }
  };
}
