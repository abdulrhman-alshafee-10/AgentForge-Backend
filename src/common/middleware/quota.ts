import type { Request, Response, NextFunction } from 'express';
import { tenantService } from '../../modules/tenants/tenant.service.js';

// ─── Quota middleware helpers ─────────────────────────────────────────────────
//
// These are thin Express middleware wrappers around the TenantService quota
// checks.  They throw AppError on violation, which the global error handler
// converts to the appropriate HTTP response (429 / 403).

/**
 * Check that the tenant has not reached its concurrent-execution limit.
 * Apply to POST /chats/:id/messages.
 */
export function checkExecutionQuota() {
  return async function executionQuotaMiddleware(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      await tenantService.checkExecutionQuota(req.user!.tenantId);
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Check that the tenant has not reached its document limit.
 * Apply to POST /documents.
 */
export function checkDocumentQuota() {
  return async function documentQuotaMiddleware(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      await tenantService.checkDocumentQuota(req.user!.tenantId);
      next();
    } catch (err) {
      next(err);
    }
  };
}
