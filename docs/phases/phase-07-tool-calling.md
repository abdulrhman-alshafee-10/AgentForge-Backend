# Phase 07 — Tool Calling

## Overview

Introduce a **tool registry** and the machinery to route LLM tool calls to safe, schema-validated executors. This phase runs tools synchronously from a stub agent; real LangGraph routing arrives in Phase 08.

## Learning objectives

- Design a tool contract: name, description, input schema, output schema, executor.
- Route LLM tool-call requests to the correct executor.
- Persist every tool call as a `ToolCall` row with status, input, output, and timing.
- Prepare the ground for human-in-the-loop approvals in Phase 11.

## Concepts to study

- Function calling / tool use in modern LLM APIs.
- JSON Schema validation (Zod or Ajv).
- Safe tool execution: timeouts, resource limits, sandboxing.
- Structured error surfaces so the LLM can react.

## Features to implement

- `ToolsModule` with a `ToolRegistry`:
  - `register(tool: ToolDefinition)`.
  - `list()` and `get(name)`.
- Initial tools:
  - `document_search(query, k)` — wraps the RAG retrieval.
  - `memory_search(query, k, scope)` — wraps long-term memory retrieval (memory writes come in Phase 12).
  - `web_search(query)` — optional; behind a feature flag and allow-listed domains.
  - `summarize(text)` — an LLM-backed helper.
  - `generate_report(sections)` — assembles a structured document.
- Tool executor service:
  - Validates input against schema.
  - Creates a `ToolCall` row (`PENDING` → `RUNNING`).
  - Runs the tool with a timeout.
  - Persists `output` or `error` and status.
  - Emits `CALLING_TOOL`, `EXECUTING_TOOL`, `TOOL_RESULT` events.
- Stub agent endpoint (temporary, for testing): `POST /executions/:id/step` that lets you manually invoke a tool for a given execution.

## Architecture changes

- Introduce `tools/` module with a `ToolDefinition` interface (conceptual):
  ```
  {
    name,
    description,
    inputSchema,   // JSON Schema
    outputSchema,  // JSON Schema
    requiresApproval, // boolean or predicate
    execute(input, ctx)
  }
  ```
- Add `ToolCallRepository`.
- Tools receive a `ToolContext` including `tenantId`, `userId`, `executionId`.

## Database changes

- Ensure `ToolCall` table matches `docs/database.md` (already created in Phase 02; verify indexes).

## Required API endpoints

- `GET /executions/:id/tool-calls`.
- Internal: tool-call events flow through the stream from Phase 05.

## Acceptance criteria

- Registering a tool with an invalid schema fails at startup.
- Calling a tool with invalid input returns a `VALIDATION_ERROR` observation (not a crash).
- Every tool call produces one `ToolCall` row and one `TOOL_RESULT` event.
- A tool exceeding its timeout is marked `ERROR` and does not hang the worker.
- Cross-tenant access from within a tool is impossible (context enforces it).

## Suggested reading

- OpenAI and Anthropic tool-use documentation.
- LangChain: Tools and StructuredTool docs.
- Zod docs on schema composition.

## Suggested exercises

1. Add a `retry: { attempts, backoffMs }` policy per tool and honor it in the executor.
2. Implement `requiresApproval` for `generate_report` — creating an `Approval` row and pausing (stubbed; Phase 11 finalizes it).
3. Add per-tool metrics (latency, error rate) via a simple in-memory counter.
4. Add a "dry-run" mode where the tool returns a description of what it would do.
5. Add tool versioning: two tools with the same name but different versions can coexist for A/B testing.
