import { ToolMessage } from '@langchain/core/messages';
import type { AgentState } from '../workflow.types.js';

// ─── Observe node ─────────────────────────────────────────────────────────────
//
// Converts the latest tool result into:
//   1. A human-readable observation string appended to `state.observations`
//      (used to build context for the next reason call).
//   2. A LangChain ToolMessage appended to `state.messages`
//      (required so the LLM sees the tool response in its history).
//
// This node is purely computational — no DB writes, no events.

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

  // Append a ToolMessage so the LLM's conversation history is coherent
  const toolMsg = new ToolMessage({
    content: observation,
    tool_call_id: lastResult.toolCallId,
  });

  return {
    observations: [...state.observations, observation],
    messages: [...state.messages, toolMsg],
  };
}
