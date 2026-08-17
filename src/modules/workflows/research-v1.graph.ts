import { StateGraph, END, START } from '@langchain/langgraph';
import { BaseMessage } from '@langchain/core/messages';
import { planNode } from './nodes/plan.node.js';
import { retrieveNode } from './nodes/retrieve.node.js';
import { retrieveMemoryNode } from './nodes/retrieve-memory.node.js';
import { reasonNode } from './nodes/reason.node.js';
import { actNode } from './nodes/act.node.js';
import { observeNode } from './nodes/observe.node.js';
import { respondNode } from './nodes/respond.node.js';
import type { AgentState } from './workflow.types.js';

// ─── Node names ───────────────────────────────────────────────────────────────

export const NODE = {
  PLAN: 'plan',
  RETRIEVE: 'retrieve',
  RETRIEVE_MEMORY: 'retrieve_memory',
  REASON: 'reason',
  ACT: 'act',
  OBSERVE: 'observe',
  RESPOND: 'respond',
} as const;

// ─── Conditional edge functions ───────────────────────────────────────────────

function afterPlan(state: AgentState): string {
  if (state.error) return NODE.RESPOND;
  return state.needsRetrieval ? NODE.RETRIEVE : NODE.RETRIEVE_MEMORY;
}

function afterReason(state: AgentState): string {
  if (state.error) return NODE.RESPOND;
  if (state.response) return NODE.RESPOND;
  if (state.pendingToolName && state.loopCount <= state.maxLoops) return NODE.ACT;
  return NODE.RESPOND;
}

function afterObserve(_state: AgentState): string {
  return NODE.REASON;
}

// ─── Graph state annotation ───────────────────────────────────────────────────
// We use the annotation API to avoid the strict channel type issues.

type RetrievedChunk = {
  id: string;
  content: string;
  documentId: string | null;
  distance: number;
};

type ToolResultItem = {
  toolCallId: string;
  toolName: string;
  status: string;
  output?: Record<string, unknown>;
  error?: Record<string, unknown>;
};

// ─── Graph factory ────────────────────────────────────────────────────────────

export function buildResearchV1Graph() {
  // Use a plain object channels definition where every channel uses the
  // "last-write wins" pattern (y ?? x).  For arrays the node returns the
  // full new array so overwrite semantics are correct.
  const channels: Record<string, { value: (x: any, y: any) => any; default: () => any }> = {
    input:             { value: (x: string, y: string) => y ?? x,          default: () => '' },
    tenantId:          { value: (x: string, y: string) => y ?? x,          default: () => '' },
    userId:            { value: (x: string, y: string) => y ?? x,          default: () => '' },
    executionId:       { value: (x: string, y: string) => y ?? x,          default: () => '' },
    chatId:            { value: (x: string, y: string) => y ?? x,          default: () => '' },
    agentId:           { value: (x: string, y: string) => y ?? x,          default: () => '' },
    systemPrompt:      { value: (x: string, y: string) => y ?? x,          default: () => '' },
    model:             { value: (x: string, y: string) => y ?? x,          default: () => 'llama3.2' },
    temperature:       { value: (x: number, y: number) => y ?? x,          default: () => 0.7 },
    plan:              { value: (_x: any, y: any) => y,                    default: () => null },
    needsRetrieval:    { value: (_x: any, y: any) => y ?? false,           default: () => false },
    retrievedChunks:   { value: (_x: any, y: RetrievedChunk[]) => y ?? [], default: () => [] },
    retrievedMemories: { value: (_x: any, y: any[]) => y ?? [],            default: () => [] },
    messages:          { value: (_x: any, y: BaseMessage[]) => y ?? [],    default: () => [] },
    toolResults:       { value: (_x: any, y: ToolResultItem[]) => y ?? [], default: () => [] },
    observations:      { value: (_x: any, y: string[]) => y ?? [],        default: () => [] },
    loopCount:         { value: (_x: any, y: number) => y ?? 0,           default: () => 0 },
    maxLoops:          { value: (x: number, y: number) => y ?? x,          default: () => 5 },
    pendingToolName:   { value: (_x: any, y: any) => y,                    default: () => null },
    pendingToolInput:  { value: (_x: any, y: any) => y,                    default: () => null },
    response:          { value: (_x: any, y: any) => y,                    default: () => null },
    error:             { value: (_x: any, y: any) => y,                    default: () => null },
  };

  // Cast to any to avoid overly strict LangGraph generic inference.
  // The graph is fully typed at the node level via AgentState.
  const graph = new StateGraph<AgentState>({ channels } as any);

  // ── Add nodes ──────────────────────────────────────────────────────────────
  graph.addNode(NODE.PLAN,     planNode     as any);
  graph.addNode(NODE.RETRIEVE, retrieveNode as any);
  graph.addNode(NODE.REASON,          reasonNode        as any);
  graph.addNode(NODE.RETRIEVE_MEMORY, retrieveMemoryNode as any);
  graph.addNode(NODE.ACT,             actNode           as any);
  graph.addNode(NODE.OBSERVE,         observeNode       as any);
  graph.addNode(NODE.RESPOND,         respondNode       as any);

  // ── Entry ─────────────────────────────────────────────────────────────────
  graph.addEdge(START as any, NODE.PLAN as any);

  // ── Conditional edges ─────────────────────────────────────────────────────
  graph.addConditionalEdges(NODE.PLAN as any, afterPlan as any, {
    [NODE.RETRIEVE]:        NODE.RETRIEVE,
    [NODE.RETRIEVE_MEMORY]: NODE.RETRIEVE_MEMORY,
    [NODE.RESPOND]:         NODE.RESPOND,
  } as any);

  // After document retrieval, always fetch memories too
  graph.addEdge(NODE.RETRIEVE as any, NODE.RETRIEVE_MEMORY as any);

  // After memory retrieval, always reason
  graph.addEdge(NODE.RETRIEVE_MEMORY as any, NODE.REASON as any);

  graph.addConditionalEdges(NODE.REASON as any, afterReason as any, {
    [NODE.ACT]:     NODE.ACT,
    [NODE.RESPOND]: NODE.RESPOND,
  } as any);

  graph.addEdge(NODE.ACT as any, NODE.OBSERVE as any);

  graph.addConditionalEdges(NODE.OBSERVE as any, afterObserve as any, {
    [NODE.REASON]: NODE.REASON,
  } as any);

  graph.addEdge(NODE.RESPOND as any, END);

  return graph.compile();
}
