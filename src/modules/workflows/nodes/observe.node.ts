import { ToolMessage } from '@langchain/core/messages';
import type { AgentState } from '../workflow.types.js';

// ─── Observe node ─────────────────────────────────────────────────────────────
//
// Converts the latest tool result into:
//   1. A human-readable observation string appended to `state.observations`
//      (used to build context for the next reason call).
//   2. A LangChain ToolMessage appended to `state.messages` — ONLY when the
//      toolCallId is a real LangChain-tracked ID (i.e. not a rejection sentinel).
//      Passing a fake ID to ToolMessage breaks LLM conversation history.
//
// This node is purely computational — no DB writes, no events.

// Sentinel prefix set by act.node when a tool was rejected/expired before running.
const REJECTION_PREFIX = 'rejected:';

export async function observeNode(state: AgentState): Promise<Partial<AgentState>> {
  const lastResult = state.toolResults[state.toolResults.length - 1];

  if (!lastResult) {
    return {};
  }

  // Build a concise observation string
  let observation: string;
  if (lastResult.status === 'SUCCESS' && lastResult.output) {
    observation = `Tool "${lastResult.toolName}" succeeded: ${JSON.stringify(lastResult.output)}`;
  } else {
    observation = `Tool "${lastResult.toolName}" failed (${lastResult.status}): ` +
      JSON.stringify(lastResult.error ?? {});
  }

  const isRejectionSentinel = lastResult.toolCallId.startsWith(REJECTION_PREFIX);

  if (isRejectionSentinel) {
    // The tool never ran — there is no matching tool_call in the AI message history,
    // so we must NOT add a ToolMessage (the LLM would reject the conversation as malformed).
    // The observation string alone gives the LLM enough context to react.
    return {
      observations: [...state.observations, observation],
    };
  }

  // Append a ToolMessage so the LLM's conversation history is coherent.
  const toolMsg = new ToolMessage({
    content: observation,
    tool_call_id: lastResult.toolCallId,
  });

  return {
    observations: [...state.observations, observation],
    messages: [...state.messages, toolMsg],
  };
}
