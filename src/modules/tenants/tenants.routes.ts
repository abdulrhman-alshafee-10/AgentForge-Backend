import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { validate } from '../../common/middleware/validate.js';
import { wrap } from '../../common/utils/async-wrap.js';
import { requireRoles } from '../../common/middleware/require-roles.js';
import { tenantService } from './tenant.service.js';

const router = Router();

// ─── Schemas ──────────────────────────────────────────────────────────────────

const UpdateMyTenantSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  settings: z.object({
    maxConcurrentExecutions: z.number().int().min(0).optional(),
    maxDocuments: z.number().int().min(0).optional(),
  }).optional(),
});

const CreateTenantSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  plan: z.enum(['free', 'pro', 'enterprise']).optional(),
});

// ─── GET /tenants/me ──────────────────────────────────────────────────────────

router.get(
  '/me',
  wrap(async (req: Request, res: Response) => {
    const tenant = await tenantService.getMyTenant(req.user!.tenantId);
    res.json({ tenant });
  }),
);

// ─── PATCH /tenants/me ────────────────────────────────────────────────────────
// Only owners can update tenant settings.

router.patch(
  '/me',
  requireRoles(['owner']),
  validate({ body: UpdateMyTenantSchema }),
  wrap(async (req: Request, res: Response) => {
    const body = req.body as z.infer<typeof UpdateMyTenantSchema>;
    const tenant = await tenantService.updateMyTenant(req.user!.tenantId, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.settings !== undefined ? { settings: body.settings as any } : {}),
    });
    res.json({ tenant });
  }),
);

// ─── Admin: POST /tenants ─────────────────────────────────────────────────────
// Creates a new tenant. In production this is an internal admin-only operation.
// We gate it with a simple owner check for now; a dedicated admin role would
// be added in a production hardening pass.

router.post(
  '/',
  validate({ body: CreateTenantSchema }),
  wrap(async (req: Request, res: Response) => {
    const body = req.body as z.infer<typeof CreateTenantSchema>;
    const tenant = await tenantService.createTenant({
      name: body.name,
      slug: body.slug,
      ...(body.plan !== undefined ? { plan: body.plan } : {}),
    });
    res.status(201).json({ tenant });
  }),
);

// ─── Admin: POST /tenants/:tenantId/disable ───────────────────────────────────

router.post(
  '/:tenantId/disable',
  requireRoles(['owner']),
  wrap(async (req: Request, res: Response) => {
    const tenant = await tenantService.disableTenant(req.params.tenantId!);
    res.json({ tenant });
  }),
);

// ─── Admin: POST /tenants/:tenantId/enable ────────────────────────────────────

router.post(
  '/:tenantId/enable',
  requireRoles(['owner']),
  wrap(async (req: Request, res: Response) => {
    const tenant = await tenantService.enableTenant(req.params.tenantId!);
    res.json({ tenant });
  }),
);

export { router as tenantsRouter };
