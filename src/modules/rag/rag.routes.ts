import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { validate } from '../../common/middleware/validate.js';
import { wrap } from '../../common/utils/async-wrap.js';
import { ragService } from './rag.service.js';

const router = Router();

// ─── Body schema ─────────────────────────────────────────────────────────────

const QueryBodySchema = z.object({
  query: z.string().min(1, 'query is required').max(2000),
  k: z.number().int().min(1).max(20).default(4),
  /** Optionally restrict retrieval to a single document */
  documentId: z.string().uuid().optional(),
});

// ─── POST /rag/query ──────────────────────────────────────────────────────────
//
// Embed the query and return the top-K most relevant chunks from the tenant's
// vector store. Useful for testing retrieval quality and as a building block for
// future agent tool calls.

router.post(
  '/query',
  validate({ body: QueryBodySchema }),
  wrap(async (req: Request, res: Response) => {
    const { query, k, documentId } = req.body as z.infer<typeof QueryBodySchema>;

    const results = await ragService.retrieveContext({
      tenantId: req.user!.tenantId,
      query,
      k,
      ...(documentId !== undefined && { documentId }),
    });

    res.json({ results });
  }),
);

export { router as ragRouter };
