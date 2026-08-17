import { Router, type Request, type Response } from 'express';
import { wrap } from '../../common/utils/async-wrap.js';
import { toolRegistry } from './tool-registry.js';

const router = Router();

// ─── GET /tools ───────────────────────────────────────────────────────────────
//
// Returns all registered tools as JSON-Schema manifests.
// Useful for the frontend to render a tool picker and for the LLM to know
// what tools are available.

router.get(
  '/',
  wrap(async (_req: Request, res: Response) => {
    res.json({ tools: toolRegistry.manifests() });
  }),
);

// ─── GET /tools/:name ─────────────────────────────────────────────────────────
//
// Returns the manifest for a single tool.

router.get(
  '/:name',
  wrap(async (req: Request, res: Response) => {
    // toolRegistry.get() throws AppError(404) if not found
    const tool = toolRegistry.get(req.params.name!);
    const manifest = toolRegistry.manifests().find((m) => m.name === tool.name)!;
    res.json({ tool: manifest });
  }),
);

export { router as toolsRouter };
