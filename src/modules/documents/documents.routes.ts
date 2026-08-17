import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { validate } from '../../common/middleware/validate.js';
import { wrap } from '../../common/utils/async-wrap.js';
import { PaginationSchema } from '../../common/utils/pagination.js';
import { documentsService } from './documents.service.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

const router = Router();

/**
 * POST /documents
 * Upload a document
 */
router.post(
  '/',
  upload.single('file'),
  wrap(async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'No file uploaded' } });
      return;
    }

    const { title } = req.body;
    
    const document = await documentsService.uploadDocument(
      req.user!.tenantId,
      req.user!.id,
      req.file.buffer,
      req.file.mimetype,
      req.file.originalname,
      title,
    );

    res.status(201).json({ document });
  })
);

/**
 * GET /documents
 */
router.get(
  '/',
  validate({ query: PaginationSchema }),
  wrap(async (req: Request, res: Response) => {
    const { cursor, limit, status } = req.query as any;
    const result = await documentsService.listDocuments(req.user!.tenantId, limit, cursor, status);
    res.json(result);
  })
);

/**
 * GET /documents/:documentId
 */
router.get(
  '/:documentId',
  wrap(async (req: Request, res: Response) => {
    const result = await documentsService.getDocument(req.user!.tenantId, req.params.documentId as string);
    res.json(result);
  })
);

/**
 * DELETE /documents/:documentId
 */
router.delete(
  '/:documentId',
  wrap(async (req: Request, res: Response) => {
    await documentsService.deleteDocument(req.user!.tenantId, req.params.documentId as string);
    res.status(204).send();
  })
);

/**
 * POST /documents/:documentId/reindex
 */
router.post(
  '/:documentId/reindex',
  wrap(async (req: Request, res: Response) => {
    const document = await documentsService.reindexDocument(req.user!.tenantId, req.params.documentId as string);
    res.json({ document });
  })
);

export { router as documentsRouter };
