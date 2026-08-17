import { prisma } from '../../db/prisma.js';
import type { Prisma, Document } from '@prisma/client';

export class DocumentsRepository {
  async create(data: Prisma.DocumentUncheckedCreateInput): Promise<Document> {
    return prisma.document.create({ data });
  }

  async findById(id: string): Promise<Document | null> {
    return prisma.document.findUnique({ where: { id } });
  }

  async findMany(
    tenantId: string,
    limit: number,
    cursor?: string,
    status?: string,
  ): Promise<Document[]> {
    const where: Prisma.DocumentWhereInput = { tenantId };
    if (status) {
      where.status = status as any;
    }

    return prisma.document.findMany({
      where,
      take: limit + 1,
      ...(cursor && {
        cursor: { id: cursor },
        skip: 1,
      }),
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(id: string, data: Prisma.DocumentUncheckedUpdateInput): Promise<Document> {
    return prisma.document.update({
      where: { id },
      data,
    });
  }

  async delete(id: string): Promise<void> {
    await prisma.document.delete({ where: { id } });
  }
}

export const documentsRepository = new DocumentsRepository();
