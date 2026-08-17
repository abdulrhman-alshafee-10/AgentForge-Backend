// ─── Approval lifecycle service ───────────────────────────────────────────────
import { approvalRepository } from './approval.repository.js';
import { eventsService } from '../executions/events.service.js';
import { enqueueResume } from '../../queues/execution.producer.js';
import { prisma } from '../../db/prisma.js';
import { ExecutionStatus, type Prisma } from '@prisma/client';
import { NotFoundError, ForbiddenError, ConflictError } from '../../common/errors/HttpErrors.js';
import { AppError } from '../../common/errors/AppError.js';
import { logger } from '../../common/logger/logger.js';
import type { ApprovalStatus } from '@prisma/client';

const DEFAULT_TTL_MS = 48 * 60 * 60 * 1000;

export class ApprovalService {
  /** Creates an Approval, transitions execution to WAITING_FOR_APPROVAL, emits event. */
  async createApproval(options: {
    tenantId: string;
    executionId: string;
    toolCallId?: string;
    reason: string;
    payload: Record<string, unknown>;
    ttlMs?: number;
  }): Promise<{ approvalId: string }> {
    const { tenantId, executionId, toolCallId, reason, payload, ttlMs = DEFAULT_TTL_MS } = options;
    const expiresAt = new Date(Date.now() + ttlMs);

    const exec = await prisma.execution.findUnique({ where: { id: executionId } });
    if (!exec) throw new AppError('Execution not found', 404, 'NOT_FOUND');

    const approval = await approvalRepository.create({
      tenantId, executionId,
      ...(toolCallId ? { toolCallId } : {}),
      reason,
      payload: payload as Prisma.InputJsonValue,
      status: 'PENDING',
      expiresAt,
    });

    await prisma.execution.update({
      where: { id: executionId },
      data: { status: ExecutionStatus.WAITING_FOR_APPROVAL },
    });

    await eventsService.appendEvent(tenantId, exec.chatId, executionId, 'WAITING_FOR_APPROVAL', {
      approvalId: approval.id, reason, toolCallId, expiresAt: expiresAt.toISOString(),
    });

    logger.info({ approvalId: approval.id, executionId }, 'Approval created — execution paused');
    return { approvalId: approval.id };
  }

  /** Records a decision, emits APPROVAL_DECISION, and re-queues the execution. */
  async decide(options: {
    approvalId: string;
    tenantId: string;
    decidedByUserId: string;
    decision: 'APPROVED' | 'REJECTED';
    note?: string;
  }): Promise<void> {
    const { approvalId, tenantId, decidedByUserId, decision, note } = options;

    const approval = await approvalRepository.findById(approvalId);
    if (!approval || approval.tenantId !== tenantId) throw new NotFoundError('Approval');
    if (approval.status !== 'PENDING') {
      throw new ConflictError(`Approval is already ${approval.status.toLowerCase()}`);
    }

    const execution = await prisma.execution.findUnique({ where: { id: approval.executionId } });
    if (!execution || execution.tenantId !== tenantId) throw new ForbiddenError('Access denied');

    await approvalRepository.decide(approvalId, decision, decidedByUserId, note);
    await eventsService.appendEvent(tenantId, execution.chatId, execution.id, 'APPROVAL_DECISION', {
      approvalId, decision, decidedBy: decidedByUserId, ...(note ? { note } : {}),
    });

    await enqueueResume(execution.id, tenantId);
    logger.info({ approvalId, executionId: execution.id, decision }, 'Approval decided');
  }

  /** Marks stale PENDING approvals as EXPIRED and re-queues their executions. */
  async expireStale(): Promise<void> {
    const stale = await approvalRepository.expireStale();
    for (const approval of stale) {
      const execution = await prisma.execution.findUnique({ where: { id: approval.executionId } });
      if (!execution) continue;
      await eventsService.appendEvent(approval.tenantId, execution.chatId, execution.id, 'APPROVAL_EXPIRED', {
        approvalId: approval.id,
      });
      await enqueueResume(execution.id, approval.tenantId);
      logger.info({ approvalId: approval.id }, 'Approval expired');
    }
  }

  async listForUser(tenantId: string, userId: string, status?: ApprovalStatus, limit = 20, cursor?: string) {
    return approvalRepository.findMany(tenantId, userId, status, limit, cursor);
  }

  async getById(approvalId: string, tenantId: string) {
    const approval = await approvalRepository.findById(approvalId);
    if (!approval || approval.tenantId !== tenantId) throw new NotFoundError('Approval');
    return approval;
  }
}

export const approvalService = new ApprovalService();
