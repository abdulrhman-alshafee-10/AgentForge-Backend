import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { validate } from '../../common/middleware/validate.js';
import { wrap } from '../../common/utils/async-wrap.js';
import { PaginationSchema } from '../../common/utils/pagination.js';
import { paginate } from '../../common/utils/pagination.js';
import { approvalService } from './approval.service.js';
import { ApprovalStatus } from '@prisma/client';

const router = Router();

// ─── Query schema ─────────────────────────────────────────────────────────────

const ListQuerySchema = PaginationSchema.extend({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED']).optional(),
});

// ─── Decision body schema ─────────────────────────────────────────────────────

const DecisionBodySchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  note: z.string().max(500).optional(),
});

// ─── GET /approvals ───────────────────────────────────────────────────────────
//
// Lists approvals for the current user's executions.

router.get(
  '/',
  validate({ query: ListQuerySchema }),
  wrap(async (req: Request, res: Response) => {
    const query = req.query as unknown as z.infer<typeof ListQuerySchema>;
    const items = await approvalService.listForUser(
      req.user!.tenantId,
      req.user!.id,
      query.status as ApprovalStatus | undefined,
      query.limit,
      query.cursor,
    );
    res.json(paginate(items, query.limit, (a) => a.id));
  }),
);

// ─── GET /approvals/:approvalId ───────────────────────────────────────────────

router.get(
  '/:approvalId',
  wrap(async (req: Request, res: Response) => {
    const approval = await approvalService.getById(
      req.params.approvalId!,
      req.user!.tenantId,
    );
    res.json({ approval });
  }),
);

// ─── POST /approvals/:approvalId/decision ─────────────────────────────────────
//
// Records an APPROVED or REJECTED decision and enqueues a resume job.

router.post(
  '/:approvalId/decision',
  validate({ body: DecisionBodySchema }),
  wrap(async (req: Request, res: Response) => {
    const { decision, note } = req.body as z.infer<typeof DecisionBodySchema>;

    await approvalService.decide({
      approvalId: req.params.approvalId!,
      tenantId: req.user!.tenantId,
      decidedByUserId: req.user!.id,
      decision,
      ...(note !== undefined ? { note } : {}),
    });

    // Return updated approval
    const approval = await approvalService.getById(
      req.params.approvalId!,
      req.user!.tenantId,
    );
    res.json({ approval });
  }),
);

export { router as approvalsRouter };
