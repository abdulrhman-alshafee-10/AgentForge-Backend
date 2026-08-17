import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { validate } from '../../common/middleware/validate.js';
import { wrap } from '../../common/utils/async-wrap.js';
import { requireRoles } from '../../common/middleware/require-roles.js';
import { userRepository } from '../../db/repositories/user.repository.js';
import { NotFoundError } from '../../common/errors/HttpErrors.js';

const router = Router();

// ─── Schemas ──────────────────────────────────────────────────────────────────

const UpdateMeSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
});

// ─── GET /users/me ────────────────────────────────────────────────────────────

router.get(
  '/me',
  wrap(async (req: Request, res: Response) => {
    const ctx = { tenantId: req.user!.tenantId };
    const user = await userRepository.findById(ctx, req.user!.id);
    if (!user) throw new NotFoundError('User');

    // Strip passwordHash before returning
    const { passwordHash: _, ...safeUser } = user;
    res.json({ user: safeUser });
  }),
);

// ─── PATCH /users/me ──────────────────────────────────────────────────────────

router.patch(
  '/me',
  validate({ body: UpdateMeSchema }),
  wrap(async (req: Request, res: Response) => {
    const ctx = { tenantId: req.user!.tenantId };
    const body = req.body as z.infer<typeof UpdateMeSchema>;

    const user = await userRepository.update(ctx, req.user!.id, {
      ...(body.displayName ? { displayName: body.displayName } : {}),
    });

    const { passwordHash: _, ...safeUser } = user;
    res.json({ user: safeUser });
  }),
);

// ─── GET /users — list tenant users (owner only) ──────────────────────────────

router.get(
  '/',
  requireRoles(['owner']),
  wrap(async (req: Request, res: Response) => {
    const ctx = { tenantId: req.user!.tenantId };
    const users = await userRepository.findAll(ctx);
    const safe = users.map(({ passwordHash: _, ...u }) => u);
    res.json({ users: safe });
  }),
);

export { router as usersRouter };
