import { documentsRepository } from './documents.repository.js';
import { storageService } from './storage.service.js';
import { extractionService } from './extraction.service.js';
import { chunkingService } from './chunking.service.js';
import { embeddingsProvider } from '../vector-store/embeddings.provider.js';
import { prisma } from '../../db/prisma.js';
import { paginate, decodeCursor } from '../../common/utils/pagination.js';
import { NotFoundError } from '../../common/errors/HttpErrors.js';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';

export class DocumentsService {
  async listDocuments(tenantId: string, limit: number, cursor?: string, status?: string) {
    const decodedCursor = cursor ? decodeCursor(cursor) : undefined;
    const items = await documentsRepository.findMany(tenantId, limit, decodedCursor, status);
    return paginate(items, limit, (doc) => doc.id);
  }

  async getDocument(tenantId: string, documentId: string) {
    const doc = await documentsRepository.findById(documentId);
    if (!doc || doc.tenantId !== tenantId) {
      throw new NotFoundError('Document');
    }
    
    const count = await prisma.embedding.count({ where: { documentId } });
    
    return { document: doc, chunks: { count } };
  }

  async deleteDocument(tenantId: string, documentId: string) {
    const doc = await documentsRepository.findById(documentId);
    if (!doc || doc.tenantId !== tenantId) {
      throw new NotFoundError('Document');
    }

    // Embeddings cascade on delete
    await documentsRepository.delete(documentId);
    await storageService.deleteFile(doc.storageKey);
  }

  /**
   * Handles document upload and triggers the ingestion pipeline.
   */
  async uploadDocument(
    tenantId: string,
    userId: string,
    fileBuffer: Buffer,
    mimeType: string,
    originalName: string,
    title?: string,
  ) {
    // 1. Save file to storage
    const storageKey = `${tenantId}/${uuidv4()}-${originalName}`;
    const absolutePath = storageService.getAbsolutePath(storageKey);
    
    await fs.mkdir(absolutePath.substring(0, absolutePath.lastIndexOf('/')), { recursive: true }).catch(() => {});
    await fs.mkdir(absolutePath.substring(0, absolutePath.lastIndexOf('\\')), { recursive: true }).catch(() => {});
    
    await fs.writeFile(absolutePath, fileBuffer);

    // 2. Create the document record
    const document = await documentsRepository.create({
      tenantId,
      userId,
      title: title || originalName,
      mimeType,
      sizeBytes: fileBuffer.length,
      storageKey,
      status: 'UPLOADED',
    });

    // 3. Process ingestion (synchronous placeholder for Phase 06)
    this.processIngestion(document.id).catch((err) => {
      console.error(`Ingestion failed for document ${document.id}:`, err);
    });

    return document;
  }

  async reindexDocument(tenantId: string, documentId: string) {
    const doc = await documentsRepository.findById(documentId);
    if (!doc || doc.tenantId !== tenantId) {
      throw new NotFoundError('Document');
    }

    await documentsRepository.update(documentId, { status: 'PROCESSING' });
    
    // Clear old embeddings
    await prisma.embedding.deleteMany({ where: { documentId } });

    // Process ingestion
    this.processIngestion(documentId).catch((err) => {
      console.error(`Reingestion failed for document ${documentId}:`, err);
    });

    return await documentsRepository.findById(documentId);
  }

  /**
   * Pipeline: Extract -> Chunk -> Embed -> Insert
   */
  private async processIngestion(documentId: string) {
    try {
      await documentsRepository.update(documentId, { status: 'PROCESSING' });
      const doc = await documentsRepository.findById(documentId);
      if (!doc) throw new Error('Document deleted before ingestion');

      const buffer = await storageService.readFile(doc.storageKey);
      
      const text = await extractionService.extractText(buffer, doc.mimeType as string);
      
      const chunks = chunkingService.chunkText(text);
      if (chunks.length === 0) {
        await documentsRepository.update(documentId, { status: 'INDEXED' });
        return;
      }

      // We should batch this if chunks > 100, but for simplicity we'll just embed all
      const embeddings = await embeddingsProvider.embedBatch(chunks);

      // Insert into Vector DB via raw SQL (since we need to cast vector literal)
      await prisma.$transaction(async (tx) => {
        for (let i = 0; i < chunks.length; i++) {
          const vectorLiteral = `[${embeddings[i].join(',')}]`;
          const metadata = JSON.stringify({ source: doc.title });
          
          await tx.$executeRaw`
            INSERT INTO "Embedding" ("id", "tenantId", "documentId", "chunkIndex", "content", "embedding", "metadata", "createdAt")
            VALUES (
              gen_random_uuid(),
              ${doc.tenantId}::uuid,
              ${doc.id}::uuid,
              ${i},
              ${chunks[i]},
              ${vectorLiteral}::vector,
              ${metadata}::jsonb,
              NOW()
            )
          `;
        }
      });

      await documentsRepository.update(documentId, { status: 'INDEXED' });
    } catch (err) {
      await documentsRepository.update(documentId, { status: 'FAILED' });
      throw err;
    }
  }
}

export const documentsService = new DocumentsService();
