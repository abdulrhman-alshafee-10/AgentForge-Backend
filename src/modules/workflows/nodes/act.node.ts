import { toolExecutorService } from '../../tools/tool-executor.service.js';
import { logger } from '../../../common/logger/logger.js';
import type { AgentState } from '../workflow.types.js';

// ─── Act node ─────────────────────────────────────────────────────────────────
//
// Dispatches the pending tool call chosen by the reason node through the
// ToolExecutorService.  The executor handles:
//   - ToolCall row creation (PENDING → RUNNING → SUCCESS/ERROR)
//   - CALLING_TOOL / EXECUTING_TOOL / TOOL_RESULT event emission
//   - Timeout enforcement
//
// This node is intentionally thin — all persistence and event emission live
// in the executor service so they can be reused outside the graph.

export async function actNode(state: AgentState): Promise<Partial<AgentState>> {
  const { tenantId, userId, executionId, pendingToolName, pendingToolInput } = state;

  if (!pendingToolName) {
    logger.warn({ executionId }, 'act node reached with no pending tool — skipping');
    return {};
  }

  const result = await toolExecutorService.invoke({
    toolName: pendingToolName,
    rawInput: pendingToolInput ?? {},
    ctx: { tenantId, userId, executionId },
  });

  return {
    toolResults: [...state.toolResults, result],
    // Clear the pending call — observe node will pick up from toolResults
    pendingToolName: null,
    pendingToolInput: null,
  };
}
