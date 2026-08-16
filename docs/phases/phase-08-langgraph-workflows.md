# Phase 08 — LangGraph Workflows

## Overview

Introduce **LangGraph** as the orchestration engine for agent reasoning. Build a first workflow graph that plans, retrieves, calls tools, and generates a response. This phase runs the graph **in-process** for simplicity; Phase 09 moves it into a worker.

## Learning objectives

- Model agent reasoning as a directed graph with typed state.
- Use conditional edges for routing.
- Emit fine-grained events at every node boundary.
- Serialize state so it can later be checkpointed.

## Concepts to study

- LangGraph: `StateGraph`, nodes, edges, conditional edges, interrupts.
- Typed state definitions and reducers.
- LLM invocations with tool-calling.
- Prompt design for a planner/executor split.

## Features to implement

- `WorkflowsModule` with a first workflow: `research-v1`.
- State shape:
  ```
  {
    input, plan?, retrievedChunks?, toolResults[], observations[], response?
  }
  ```
- Nodes:
  1. `plan` — LLM decides the plan.
  2. `retrieve` — calls `document_search` tool.
  3. `reason` — LLM decides next tool or final answer.
  4. `act` — dispatches to a tool via the registry.
  5. `observe` — appends tool result to state.
  6. `respond` — LLM produces the final message; streams deltas as `RESPONSE_DELTA` events.
- Conditional edges:
  - After `plan`, go to `retrieve` if plan says so, else `reason`.
  - After `reason`, loop to `act` or exit to `respond`.
- Emit corresponding SSE events at each node boundary.
- Wire `POST /chats/:id/messages` to trigger the workflow **in-process** for now (still emits events).

## Architecture changes

- Add `workflows/` module with a graph factory and node implementations.
- Add an `AgentRunner` service that:
  - Loads the workflow for the chat's agent.
  - Runs it with the message as input.
  - Emits events, writes messages, updates execution status.
- Keep the runner thin and side-effect-oriented; nodes should be pure where possible.

## Database changes

- Populate `Message` rows with role `tool` when tools produce observations (optional; agent memory can hold them instead).
- Set `Execution.workflowVersion` to `research-v1`.

## Required API endpoints

No new endpoints. `POST /chats/:id/messages` now triggers a real run.

## Acceptance criteria

- Sending a message runs the graph end-to-end and produces an assistant message.
- The SSE stream shows the expected event sequence: `PLANNING` → `RETRIEVING_DOCUMENTS` → `CALLING_TOOL` → `TOOL_RESULT` → `GENERATING_RESPONSE` → `RESPONSE_DELTA*` → `COMPLETED`.
- Errors inside a node transition the execution to `FAILED` with a persisted `FAILED` event.
- State is JSON-serializable at every node boundary (checkpointing readiness).

## Suggested reading

- LangGraph documentation (StateGraph, conditional edges, interrupts).
- LangChain: LCEL, PromptTemplate, Runnable interface.
- Papers: ReAct, Reflexion (for intuition).

## Suggested exercises

1. Add a `critic` node that reviews the response before `respond` and can send the state back to `reason`.
2. Add a **parallel** branch: retrieve from documents and memories simultaneously, then merge.
3. Introduce a hard cap on the reason ↔ act loop count and fail gracefully when hit.
4. Add a mock LLM adapter for deterministic tests and write a golden test for one input.
5. Log every LLM invocation with prompt, response, token counts, and duration.
