// ─── JWT authentication middleware ───────────────────────────────────────────
import { AsyncLocalStorage } from 'async_hooks';
import type { Request, Response, NextFunction } from 'express';
import { UnauthenticatedError } from '../errors/index.js';
import { tokenService } from '../../modules/auth/token.service.js';
import type { AuthUser } from '../../modules/auth/auth.types.js';

export interface TenantALS {
  userId: string;
  tenantId: string;
  role: AuthUser['role'];
}

/** AsyncLocalStorage that makes the current tenant context available without prop-drilling. */
export const tenantALS = new AsyncLocalStorage<TenantALS>();

export function getTenantContext(): TenantALS | undefined {
  return tenantALS.getStore();
}

/** Verifies the Bearer token, attaches req.user, and sets the ALS tenant context. */
export function authenticate() {
  return function authenticateMiddleware(req: Request, _res: Response, next: NextFunction): void {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return next(new UnauthenticatedError());

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
      tenantALS.run({ userId: user.id, tenantId: user.tenantId, role: user.role }, next);
    } catch {
      next(new UnauthenticatedError());
    }
  };
}
