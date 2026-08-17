import { Router, type Request, type Response } from 'express';
import { wrap } from '../../common/utils/async-wrap.js';
import { prisma } from '../../db/prisma.js';
import { NotFoundError } from '../../common/errors/HttpErrors.js';

// ─── Agents router ────────────────────────────────────────────────────────────
//
// Agents are pre-configured in the database (via seed or admin tools).
// This router exposes read-only access for the current tenant.

const router = Router();

// ─── GET /agents ──────────────────────────────────────────────────────────────

router.get(
  '/',
  wrap(async (req: Request, res: Response) => {
    const agents = await prisma.agent.findMany({
      where: {
        OR: [
          { tenantId: req.user!.tenantId },
          { tenantId: null }, // global / shared agents
        ],
      },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        description: true,
        model: true,
        temperature: true,
        tools: true,
        workflowVersion: true,
        createdAt: true,
        updatedAt: true,
        // omit systemPrompt from the list view — can be sensitive
      },
    });

    res.json({ agents });
  }),
);

// ─── GET /agents/:agentId ─────────────────────────────────────────────────────

router.get(
  '/:agentId',
  wrap(async (req: Request, res: Response) => {
    const agent = await prisma.agent.findFirst({
      where: {
        id: req.params.agentId!,
        OR: [
          { tenantId: req.user!.tenantId },
          { tenantId: null },
        ],
      },
    });

    if (!agent) throw new NotFoundError('Agent');

    res.json({ agent });
  }),
);

export { router as agentsRouter };
