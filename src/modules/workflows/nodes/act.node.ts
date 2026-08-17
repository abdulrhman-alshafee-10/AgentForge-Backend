import { toolRegistry } from '../../tools/tool-registry.js';
import { toolExecutorService } from '../../tools/tool-executor.service.js';
import { approvalService } from '../../approvals/approval.service.js';
import { toolCallRepository } from '../../tools/tool-call.repository.js';
import { logger } from '../../../common/logger/logger.js';
import type { AgentState } from '../workflow.types.js';

// ─── Approval pause sentinel ──────────────────────────────────────────────────
//
// Thrown by the act node when a tool requires approval.
// The AgentRunner catches this, saves a checkpoint, and releases the worker.
// A resume job re-enters the graph after the decision is recorded.

export class ApprovalRequiredError extends Error {
  readonly isNonRetryable = true;
  readonly approvalId: string;
  constructor(approvalId: string, toolName: string) {
    super(`Tool "${toolName}" requires approval (approvalId: ${approvalId})`);
    this.name = 'ApprovalRequiredError';
    this.approvalId = approvalId;
  }
}

// ─── Act node ─────────────────────────────────────────────────────────────────
//
// Dispatches the pending tool call chosen by the reason node.
//
// If the tool has requiresApproval=true:
//   1. Create a ToolCall row (PENDING) to anchor the approval.
//   2. Create an Approval row and pause the execution.
//   3. Throw ApprovalRequiredError — AgentRunner saves a checkpoint and exits.
//
// On resume (after approval decision):
//   - If APPROVED: execute the tool normally.
//   - If REJECTED/EXPIRED: return a rejection observation without executing.
//
// If the tool does NOT require approval: execute immediately (same as before).

export async function actNode(state: AgentState): Promise<Partial<AgentState>> {
  const { tenantId, userId, executionId, pendingToolName, pendingToolInput } = state;

  if (!pendingToolName) {
    logger.warn({ executionId }, 'act node reached with no pending tool — skipping');
    return {};
  }

  const tool = toolRegistry.get(pendingToolName);

  // ── Approval gate ──────────────────────────────────────────────────────────
  if (tool.requiresApproval) {
    // Check if there is already an APPROVED or REJECTED decision for this
    // pending tool call (we are resuming after an approval decision).
    const approvalDecision = await checkExistingApprovalDecision(
      executionId,
      pendingToolName,
    );

    if (approvalDecision === null) {
      // No decision yet — create an Approval and pause.
      const toolCall = await toolCallRepository.create({
        tenantId,
        executionId,
        toolName: pendingToolName,
        input: (pendingToolInput ?? {}) as any,
        status: 'PENDING',
      });

      const { approvalId } = await approvalService.createApproval({
        tenantId,
        executionId,
        toolCallId: toolCall.id,
        reason: `Tool "${pendingToolName}" requires human approval before execution.`,
        payload: {
          toolName: pendingToolName,
          input: pendingToolInput ?? {},
        },
      });

      throw new ApprovalRequiredError(approvalId, pendingToolName);
    }

    if (approvalDecision === 'REJECTED' || approvalDecision === 'EXPIRED') {
      // Human rejected — return an observation without running the tool.
      logger.info(
        { executionId, pendingToolName, approvalDecision },
        'act node: tool rejected by approver',
      );

      return {
        toolResults: [
          ...state.toolResults,
          {
            toolCallId: 'rejected',
            toolName: pendingToolName,
            status: 'ERROR' as const,
            error: {
              message: `Tool "${pendingToolName}" was ${approvalDecision.toLowerCase()} by a human reviewer.`,
              code: 'APPROVAL_REJECTED',
            },
          },
        ],
        pendingToolName: null,
        pendingToolInput: null,
      };
    }

    // approvalDecision === 'APPROVED' — fall through to normal execution below
    logger.info(
      { executionId, pendingToolName },
      'act node: tool approved — executing',
    );
  }

  // ── Normal execution ───────────────────────────────────────────────────────
  const result = await toolExecutorService.invoke({
    toolName: pendingToolName,
    rawInput: pendingToolInput ?? {},
    ctx: { tenantId, userId, executionId },
  });

  return {
    toolResults: [...state.toolResults, result],
    pendingToolName: null,
    pendingToolInput: null,
  };
}

// ─── Helper: check latest approval decision for pending tool ─────────────────

async function checkExistingApprovalDecision(
  executionId: string,
  toolName: string,
): Promise<'APPROVED' | 'REJECTED' | 'EXPIRED' | null> {
  const { prisma } = await import('../../../db/prisma.js');

  const approval = await prisma.approval.findFirst({
    where: {
      executionId,
      payload: { path: ['toolName'], equals: toolName },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!approval) return null;
  if (approval.status === 'PENDING') return null; // still waiting
  if (approval.status === 'APPROVED') return 'APPROVED';
  if (approval.status === 'REJECTED') return 'REJECTED';
  if (approval.status === 'EXPIRED') return 'EXPIRED';
  return null;
}
