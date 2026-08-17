import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { validate } from '../../common/middleware/validate.js';
import { wrap } from '../../common/utils/async-wrap.js';
import { PaginationSchema } from '../../common/utils/pagination.js';
import { checkDocumentQuota } from '../../common/middleware/quota.js';
import { documentsService } from './documents.service.js';

// ─── Multer — memory storage, 10 MB cap ──────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// ─── Query schemas ────────────────────────────────────────────────────────────

const ListQuerySchema = PaginationSchema.extend({
  status: z.enum(['UPLOADED', 'PROCESSING', 'INDEXED', 'FAILED']).optional(),
});

const router = Router();

// ─── POST /documents ──────────────────────────────────────────────────────────
//
// Multipart upload. Body field `title` is optional; falls back to the filename.

router.post(
  '/',
  upload.single('file'),
  checkDocumentQuota(),
  wrap(async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'No file uploaded' } });
      return;
    }

    const title = typeof req.body?.title === 'string' ? req.body.title : undefined;

    const document = await documentsService.uploadDocument(
      req.user!.tenantId,
      req.user!.id,
      req.file.buffer,
      req.file.mimetype,
      req.file.originalname,
      title,
    );

    res.status(201).json({ document });
  }),
);

// ─── GET /documents ───────────────────────────────────────────────────────────

router.get(
  '/',
  validate({ query: ListQuerySchema }),
  wrap(async (req: Request, res: Response) => {
    const query = req.query as unknown as z.infer<typeof ListQuerySchema>;
    const result = await documentsService.listDocuments(
      req.user!.tenantId,
      query.limit,
      query.cursor,
      query.status,
    );
    res.json(result);
  }),
);

// ─── GET /documents/:documentId ──────────────────────────────────────────────

router.get(
  '/:documentId',
  wrap(async (req: Request, res: Response) => {
    const result = await documentsService.getDocument(
      req.user!.tenantId,
      req.params.documentId!,
    );
    res.json(result);
  }),
);

// ─── DELETE /documents/:documentId ───────────────────────────────────────────

router.delete(
  '/:documentId',
  wrap(async (req: Request, res: Response) => {
    await documentsService.deleteDocument(
      req.user!.tenantId,
      req.params.documentId!,
    );
    res.status(204).send();
  }),
);

// ─── POST /documents/:documentId/reindex ─────────────────────────────────────
//
// Clears existing embeddings and re-runs the full ingestion pipeline.

router.post(
  '/:documentId/reindex',
  wrap(async (req: Request, res: Response) => {
    const document = await documentsService.reindexDocument(
      req.user!.tenantId,
      req.params.documentId!,
    );
    res.json({ document });
  }),
);

export { router as documentsRouter };
