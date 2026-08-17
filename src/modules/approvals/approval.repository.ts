import { prisma } from '../../db/prisma.js';
import { ApprovalStatus } from '@prisma/client';
import type { Prisma, Approval } from '@prisma/client';

// ─── Approval Repository ──────────────────────────────────────────────────────

export class ApprovalRepository {
  async create(data: Prisma.ApprovalUncheckedCreateInput): Promise<Approval> {
    return prisma.approval.create({ data });
  }

  async findById(id: string): Promise<Approval | null> {
    return prisma.approval.findUnique({ where: { id } });
  }

  /** List approvals visible to a user, optionally filtered by status. */
  async findMany(
    tenantId: string,
    userId: string,
    status?: ApprovalStatus,
    limit = 20,
    cursor?: string,
  ): Promise<Approval[]> {
    return prisma.approval.findMany({
      where: {
        tenantId,
        execution: { userId },            // only approvals for this user's executions
        ...(status ? { status } : {}),
      },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Transition PENDING → APPROVED or REJECTED with actor and timestamp. */
  async decide(
    id: string,
    decision: 'APPROVED' | 'REJECTED',
    decidedBy: string,
    note?: string,
  ): Promise<Approval> {
    return prisma.approval.update({
      where: { id },
      data: {
        status: decision === 'APPROVED' ? ApprovalStatus.APPROVED : ApprovalStatus.REJECTED,
        decidedBy,
        decidedAt: new Date(),
        ...(note ? { payload: { note } satisfies Prisma.InputJsonValue } : {}),
      },
    });
  }

  /** Mark expired approvals and return the list for re-queuing. */
  async expireStale(): Promise<Approval[]> {
    const stale = await prisma.approval.findMany({
      where: {
        status: ApprovalStatus.PENDING,
        expiresAt: { lt: new Date() },
      },
    });

    if (stale.length > 0) {
      await prisma.approval.updateMany({
        where: { id: { in: stale.map((a) => a.id) } },
        data: { status: ApprovalStatus.EXPIRED },
      });
    }

    return stale;
  }
}

export const approvalRepository = new ApprovalRepository();
