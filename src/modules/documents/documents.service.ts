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

// ─── Batch size for embedding calls ──────────────────────────────────────────
// Ollama has no hard limit, but keep batches small to avoid memory pressure.
const EMBED_BATCH_SIZE = 50;

export class DocumentsService {
  // ─── List ───────────────────────────────────────────────────────────────────

  async listDocuments(tenantId: string, limit: number, cursor?: string, status?: string) {
    const decodedCursor = cursor ? decodeCursor(cursor) : undefined;
    const items = await documentsRepository.findMany(tenantId, limit, decodedCursor, status);
    return paginate(items, limit, (doc) => doc.id);
  }

  // ─── Get ────────────────────────────────────────────────────────────────────

  async getDocument(tenantId: string, documentId: string) {
    const doc = await documentsRepository.findById(documentId);
    if (!doc || doc.tenantId !== tenantId) {
      throw new NotFoundError('Document');
    }

    const chunkCount = await prisma.embedding.count({ where: { documentId } });

    return { document: doc, chunks: { count: chunkCount } };
  }

  // ─── Delete ─────────────────────────────────────────────────────────────────

  async deleteDocument(tenantId: string, documentId: string): Promise<void> {
    const doc = await documentsRepository.findById(documentId);
    if (!doc || doc.tenantId !== tenantId) {
      throw new NotFoundError('Document');
    }

    // Embeddings cascade via DB onDelete: Cascade
    await documentsRepository.delete(documentId);
    await storageService.deleteFile(doc.storageKey).catch((err) => {
      // Storage deletion failure is non-fatal — log and continue.
      logger.warn({ err, documentId }, 'Failed to delete document from storage');
    });
  }

  // ─── Upload ─────────────────────────────────────────────────────────────────

  async uploadDocument(
    tenantId: string,
    userId: string,
    fileBuffer: Buffer,
    mimeType: string,
    originalName: string,
    title?: string,
  ) {
    // 1. Build a tenant-scoped storage key and write the file.
    const storageKey = `${tenantId}/${uuidv4()}-${originalName}`;
    const absolutePath = storageService.getAbsolutePath(storageKey);

    // Ensure the directory exists cross-platform (path.dirname handles both / and \).
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, fileBuffer);

    // 2. Create the Document record.
    const document = await documentsRepository.create({
      tenantId,
      userId,
      title: title ?? originalName,
      mimeType,
      sizeBytes: fileBuffer.length,
      storageKey,
      status: 'UPLOADED',
    });

    // 3. Kick off the ingestion pipeline fire-and-forget.
    //    Phase 09 will move this into a proper background job queue.
    this.processIngestion(document.id).catch((err) => {
      logger.error({ err, documentId: document.id }, 'Document ingestion failed');
    });

    return document;
  }

  // ─── Reindex ────────────────────────────────────────────────────────────────

  async reindexDocument(tenantId: string, documentId: string) {
    const doc = await documentsRepository.findById(documentId);
    if (!doc || doc.tenantId !== tenantId) {
      throw new NotFoundError('Document');
    }

    // Clear old embeddings, then re-run the pipeline.
    await prisma.embedding.deleteMany({ where: { documentId } });
    await documentsRepository.update(documentId, { status: 'UPLOADED' });

    this.processIngestion(documentId).catch((err) => {
      logger.error({ err, documentId }, 'Document re-ingestion failed');
    });

    return documentsRepository.findById(documentId);
  }

  // ─── Ingestion pipeline ──────────────────────────────────────────────────────
  //
  // Stages: UPLOADED → PROCESSING → (extract → chunk → embed → insert) → INDEXED
  //                                                                     ↓ on error
  //                                                                   FAILED

  private async processIngestion(documentId: string): Promise<void> {
    await documentsRepository.update(documentId, { status: 'PROCESSING' });

    try {
      const doc = await documentsRepository.findById(documentId);
      if (!doc) throw new Error('Document deleted before ingestion could start');

      logger.info({ documentId, title: doc.title }, 'Starting document ingestion');

      // 1. Load raw bytes from storage.
      const buffer = await storageService.readFile(doc.storageKey);

      // 2. Extract text.
      const text = await extractionService.extractText(buffer, doc.mimeType);

      // 3. Chunk the text.
      const chunks = chunkingService.chunkText(text);
      if (chunks.length === 0) {
        logger.warn({ documentId }, 'Document produced zero chunks — marking as INDEXED');
        await documentsRepository.update(documentId, { status: 'INDEXED' });
        return;
      }

      logger.info({ documentId, chunks: chunks.length }, 'Embedding chunks');

      // 4. Embed in batches.
      const allEmbeddings: number[][] = [];
      for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
        const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
        const batchEmbeddings = await embeddingsProvider.embedBatch(batch);
        allEmbeddings.push(...batchEmbeddings);
      }

      // 5. Insert Embedding rows via raw SQL (pgvector doesn't have Prisma native support).
      //    Each INSERT is atomic within the transaction; if any fails the whole batch rolls back.
      await prisma.$transaction(async (tx) => {
        for (let i = 0; i < chunks.length; i++) {
          const embedding = allEmbeddings[i];
          const chunk = chunks[i];
          if (!embedding || !chunk) continue; // safety guard — should never happen

          const vectorLiteral = `[${embedding.join(',')}]`;
          const metadata = JSON.stringify({ source: doc.title, chunkIndex: i });

          await tx.$executeRaw`
            INSERT INTO "Embedding" ("id", "tenantId", "documentId", "chunkIndex", "content", "embedding", "metadata", "createdAt")
            VALUES (
              gen_random_uuid(),
              ${doc.tenantId}::uuid,
              ${doc.id}::uuid,
              ${i},
              ${chunk},
              ${vectorLiteral}::vector,
              ${metadata}::jsonb,
              NOW()
            )
          `;
        }
      });

      await documentsRepository.update(documentId, { status: 'INDEXED' });
      logger.info({ documentId, chunks: chunks.length }, 'Document ingestion complete');
    } catch (err) {
      logger.error({ err, documentId }, 'Document ingestion failed — marking FAILED');
      await documentsRepository.update(documentId, { status: 'FAILED' }).catch(() => {});
      throw err;
    }
  }
}

export const documentsService = new DocumentsService();
