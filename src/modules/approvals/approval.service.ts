import { approvalRepository } from './approval.repository.js';
import { eventsService } from '../executions/events.service.js';
import { enqueueResume } from '../../queues/execution.producer.js';
import { prisma } from '../../db/prisma.js';
import { ExecutionStatus, type Prisma } from '@prisma/client';
import { NotFoundError, ForbiddenError, ConflictError } from '../../common/errors/HttpErrors.js';
import { logger } from '../../common/logger/logger.js';
import type { ApprovalStatus } from '@prisma/client';

// ─── Default approval TTL: 48 hours ──────────────────────────────────────────
const DEFAULT_TTL_MS = 48 * 60 * 60 * 1000;

export class ApprovalService {
  // ─── Create ────────────────────────────────────────────────────────────────
  //
  // Called by the act node when a tool requires approval.
  // Creates the Approval row, transitions the execution to WAITING_FOR_APPROVAL,
  // and emits the WAITING_FOR_APPROVAL event so the SSE client can reflect it.

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

    const approval = await approvalRepository.create({
      tenantId,
      executionId,
      ...(toolCallId ? { toolCallId } : {}),
      reason,
      payload: payload as Prisma.InputJsonValue,
      status: 'PENDING',
      expiresAt,
    });

    // Update execution status
    await prisma.execution.update({
      where: { id: executionId },
      data: { status: ExecutionStatus.WAITING_FOR_APPROVAL },
    });

    // Get chatId for event
    const exec = await prisma.execution.findUnique({ where: { id: executionId } });

    await eventsService.appendEvent(tenantId, exec?.chatId ?? '', executionId, 'WAITING_FOR_APPROVAL', {
      approvalId: approval.id,
      reason,
      toolCallId,
      expiresAt: expiresAt.toISOString(),
    });

    logger.info({ approvalId: approval.id, executionId }, 'Approval created — execution paused');

    return { approvalId: approval.id };
  }

  // ─── Decide ────────────────────────────────────────────────────────────────
  //
  // Called by POST /approvals/:id/decision.
  // Validates ownership, records the decision, emits APPROVAL_DECISION, and
  // enqueues a resume job so the worker can continue or handle rejection.

  async decide(options: {
    approvalId: string;
    tenantId: string;
    decidedByUserId: string;
    decision: 'APPROVED' | 'REJECTED';
    note?: string;
  }): Promise<void> {
    const { approvalId, tenantId, decidedByUserId, decision, note } = options;

    const approval = await approvalRepository.findById(approvalId);
    if (!approval || approval.tenantId !== tenantId) {
      throw new NotFoundError('Approval');
    }

    if (approval.status !== 'PENDING') {
      throw new ConflictError(
        `Approval is already ${approval.status.toLowerCase()} — cannot decide again`,
      );
    }

    // Verify the deciding user belongs to the same tenant's execution
    const execution = await prisma.execution.findUnique({
      where: { id: approval.executionId },
    });
    if (!execution || execution.tenantId !== tenantId) {
      throw new ForbiddenError('Access denied');
    }

    // Record decision
    await approvalRepository.decide(approvalId, decision, decidedByUserId, note);

    // Emit APPROVAL_DECISION event
    await eventsService.appendEvent(
      tenantId,
      execution.chatId,
      execution.id,
      'APPROVAL_DECISION',
      {
        approvalId,
        decision,
        decidedBy: decidedByUserId,
        ...(note ? { note } : {}),
      },
    );

    // Re-queue the execution so a worker can resume it
    await enqueueResume(execution.id, tenantId);

    logger.info(
      { approvalId, executionId: execution.id, decision },
      'Approval decided — resume enqueued',
    );
  }

  // ─── Expire stale approvals ────────────────────────────────────────────────
  //
  // Called periodically (e.g. every minute via setInterval in worker.ts).
  // Marks PENDING approvals past their expiresAt as EXPIRED and re-queues
  // their executions so the worker can record a rejection observation.

  async expireStale(): Promise<void> {
    const stale = await approvalRepository.expireStale();

    for (const approval of stale) {
      const execution = await prisma.execution.findUnique({
        where: { id: approval.executionId },
      });
      if (!execution) continue;

      await eventsService.appendEvent(
        approval.tenantId,
        execution.chatId,
        execution.id,
        'APPROVAL_EXPIRED',
        { approvalId: approval.id },
      );

      await enqueueResume(execution.id, approval.tenantId);

      logger.info({ approvalId: approval.id }, 'Approval expired — resume enqueued');
    }
  }

  // ─── Get for user ──────────────────────────────────────────────────────────

  async listForUser(
    tenantId: string,
    userId: string,
    status?: ApprovalStatus,
    limit = 20,
    cursor?: string,
  ) {
    return approvalRepository.findMany(tenantId, userId, status, limit, cursor);
  }

  async getById(approvalId: string, tenantId: string) {
    const approval = await approvalRepository.findById(approvalId);
    if (!approval || approval.tenantId !== tenantId) {
      throw new NotFoundError('Approval');
    }
    return approval;
  }
}

export const approvalService = new ApprovalService();
