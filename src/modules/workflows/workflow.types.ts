import type { BaseMessage } from '@langchain/core/messages';

// ─── Agent state ──────────────────────────────────────────────────────────────
//
// This is the shared state that flows through every node of the graph.
// Every field must be JSON-serialisable so the state can be checkpointed
// (Phase 10).
//
// LangGraph merges state via reducers.  Arrays use the `add` reducer so each
// node appends rather than replaces.

export interface AgentState {
  // ── Input ─────────────────────────────────────────────────────────────────
  /** Original user message content */
  input: string;
  /** Tenant and execution context — set once, never mutated */
  tenantId: string;
  userId: string;
  executionId: string;
  chatId: string;
  agentId: string;
  /** The agent's system prompt */
  systemPrompt: string;
  /** LLM model name (e.g. "llama3.2") */
  model: string;
  /** LLM temperature */
  temperature: number;

  // ── Planning ──────────────────────────────────────────────────────────────
  /** High-level plan produced by the plan node */
  plan: string | null;
  /** Whether the plan requires a document retrieval step */
  needsRetrieval: boolean;

  // ── Retrieval ─────────────────────────────────────────────────────────────
  retrievedChunks: Array<{
    id: string;
    content: string;
    documentId: string | null;
    distance: number;
  }>;

  // ── ReAct loop ────────────────────────────────────────────────────────────
  /** Full LangChain message history passed to the LLM */
  messages: BaseMessage[];
  /** Structured tool results accumulated across act/observe cycles */
  toolResults: Array<{
    toolCallId: string;
    toolName: string;
    status: string;
    output?: Record<string, unknown>;
    error?: Record<string, unknown>;
  }>;
  /** Human-readable observation strings appended after each tool call */
  observations: string[];
  /** Number of reason→act loops executed (guards against infinite loops) */
  loopCount: number;
  /** Max loops before forcing a respond */
  maxLoops: number;
  /** Pending tool call requested by the LLM in the reason node */
  pendingToolName: string | null;
  pendingToolInput: Record<string, unknown> | null;

  // ── Response ──────────────────────────────────────────────────────────────
  /** Final assistant response text */
  response: string | null;

  // ── Error ─────────────────────────────────────────────────────────────────
  error: string | null;
}

// ─── Initial state factory ────────────────────────────────────────────────────

export function createInitialState(overrides: Partial<AgentState> & {
  input: string;
  tenantId: string;
  userId: string;
  executionId: string;
  chatId: string;
  agentId: string;
  systemPrompt: string;
  model: string;
  temperature: number;
}): AgentState {
  return {
    plan: null,
    needsRetrieval: false,
    retrievedChunks: [],
    messages: [],
    toolResults: [],
    observations: [],
    loopCount: 0,
    maxLoops: 5,
    pendingToolName: null,
    pendingToolInput: null,
    response: null,
    error: null,
    ...overrides,
  };
}
