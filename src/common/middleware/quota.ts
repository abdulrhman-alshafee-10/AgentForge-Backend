// ─── Tenant quota middleware ──────────────────────────────────────────────────
import type { Request, Response, NextFunction } from 'express';
import { tenantService } from '../../modules/tenants/tenant.service.js';

/** Rejects the request when the tenant's concurrent-execution limit is reached. */
export function checkExecutionQuota() {
  return async function (req: Request, _res: Response, next: NextFunction): Promise<void> {
    try {
      await tenantService.checkExecutionQuota(req.user!.tenantId);
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Rejects the request when the tenant's document limit is reached. */
export function checkDocumentQuota() {
  return async function (req: Request, _res: Response, next: NextFunction): Promise<void> {
    try {
      await tenantService.checkDocumentQuota(req.user!.tenantId);
      next();
    } catch (err) {
      next(err);
    }
  };
}
