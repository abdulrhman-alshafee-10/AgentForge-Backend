// ─── Documents service ────────────────────────────────────────────────────────
import path from 'path';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { documentsRepository } from './documents.repository.js';
import { storageService } from './storage.service.js';
import { extractionService } from './extraction.service.js';
import { chunkingService } from './chunking.service.js';
import { embeddingsProvider } from '../vector-store/embeddings.provider.js';
import { prisma } from '../../db/prisma.js';
import { paginate, decodeCursor } from '../../common/utils/pagination.js';
import { NotFoundError } from '../../common/errors/HttpErrors.js';
import { logger } from '../../common/logger/logger.js';

const EMBED_BATCH_SIZE = 50;

export class DocumentsService {
  async listDocuments(tenantId: string, limit: number, cursor?: string, status?: string) {
    const decodedCursor = cursor ? decodeCursor(cursor) : undefined;
    const items = await documentsRepository.findMany(tenantId, limit, decodedCursor, status);
    return paginate(items, limit, (doc) => doc.id);
  }

  async getDocument(tenantId: string, documentId: string) {
    const doc = await documentsRepository.findById(documentId);
    if (!doc || doc.tenantId !== tenantId) throw new NotFoundError('Document');
    const chunkCount = await prisma.embedding.count({ where: { documentId } });
    return { document: doc, chunks: { count: chunkCount } };
  }

  async deleteDocument(tenantId: string, documentId: string): Promise<void> {
    const doc = await documentsRepository.findById(documentId);
    if (!doc || doc.tenantId !== tenantId) throw new NotFoundError('Document');
    await documentsRepository.delete(documentId);
    await storageService.deleteFile(doc.storageKey).catch((err) => {
      logger.warn({ err, documentId }, 'Storage deletion failed (non-fatal)');
    });
  }

  async uploadDocument(
    tenantId: string,
    userId: string,
    fileBuffer: Buffer,
    mimeType: string,
    originalName: string,
    title?: string,
  ) {
    const safeFilename = path.basename(originalName);
    const storageKey = `${tenantId}/${uuidv4()}-${safeFilename}`;
    const absolutePath = storageService.getAbsolutePath(storageKey);

    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, Buffer.from(fileBuffer));

    const document = await documentsRepository.create({
      tenantId, userId,
      title: title ?? originalName,
      mimeType,
      sizeBytes: fileBuffer.length,
      storageKey,
      status: 'UPLOADED',
    });

    this.processIngestion(document.id).catch((err) => {
      logger.error({ err, documentId: document.id }, 'Document ingestion failed');
    });

    return document;
  }

  async reindexDocument(tenantId: string, documentId: string) {
    const doc = await documentsRepository.findById(documentId);
    if (!doc || doc.tenantId !== tenantId) throw new NotFoundError('Document');

    await prisma.embedding.deleteMany({ where: { documentId } });
    await documentsRepository.update(documentId, { status: 'UPLOADED' });

    this.processIngestion(documentId).catch((err) => {
      logger.error({ err, documentId }, 'Document re-ingestion failed');
    });

    return documentsRepository.findById(documentId);
  }

  // ─── Ingestion pipeline ───────────────────────────────────────────────────

  private async processIngestion(documentId: string): Promise<void> {
    await documentsRepository.update(documentId, { status: 'PROCESSING' });
    try {
      const doc = await documentsRepository.findById(documentId);
      if (!doc) throw new Error('Document deleted before ingestion');

      logger.info({ documentId, title: doc.title }, 'Ingestion started');

      const buffer = await storageService.readFile(doc.storageKey);
      const text = await extractionService.extractText(buffer, doc.mimeType);
      const chunks = chunkingService.chunkText(text);

      if (chunks.length === 0) {
        await documentsRepository.update(documentId, { status: 'INDEXED' });
        return;
      }

      const allEmbeddings: number[][] = [];
      for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
        const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
        allEmbeddings.push(...(await embeddingsProvider.embedBatch(batch)));
      }

      await prisma.$transaction(async (tx) => {
        for (let i = 0; i < chunks.length; i++) {
          const embedding = allEmbeddings[i];
          const chunk = chunks[i];
          if (!embedding || !chunk) continue;

          const vectorLiteral = `[${embedding.join(',')}]`;
          const metadata = JSON.stringify({ source: doc.title, chunkIndex: i });
          await tx.$executeRaw`
            INSERT INTO "Embedding" ("id","tenantId","documentId","chunkIndex","content","embedding","metadata","createdAt")
            VALUES (gen_random_uuid(),${doc.tenantId}::uuid,${doc.id}::uuid,${i},${chunk},${vectorLiteral}::vector,${metadata}::jsonb,NOW())
          `;
        }
      });

      await documentsRepository.update(documentId, { status: 'INDEXED' });
      logger.info({ documentId, chunks: chunks.length }, 'Ingestion complete');
    } catch (err) {
      logger.error({ err, documentId }, 'Ingestion failed');
      await documentsRepository.update(documentId, { status: 'FAILED' }).catch(() => {});
      throw err;
    }
  }
}

export const documentsService = new DocumentsService();
