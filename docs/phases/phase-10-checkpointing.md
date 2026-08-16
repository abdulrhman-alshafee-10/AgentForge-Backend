# Phase 10 — Checkpointing

## Overview

Make workflows **crash-safe** and **resumable**. Persist the LangGraph state after every significant node into the `Checkpoint` table. On worker restart or job retry, load the latest checkpoint and resume from there instead of starting over.

## Learning objectives

- Implement a Postgres-backed LangGraph checkpointer.
- Design a state shape that is JSON-serializable and version-safe.
- Avoid duplicate side effects during resume (idempotent tool calls).
- Prune old checkpoints without breaking recovery.

## Concepts to study

- LangGraph checkpointer interface.
- State versioning and forward-compatible migrations.
- Idempotency for side effects (deduplicating tool calls).
- Recovery testing patterns.

## Features to implement

- `CheckpointsModule`:
  - `PostgresCheckpointer` implementing LangGraph's checkpointer interface.
  - Writes: `saveCheckpoint(executionId, nodeName, state, parentId?)`.
  - Reads: `getLatestCheckpoint(executionId)`.
- Integrate the checkpointer into the workflow so it saves after each node.
- Update the worker to:
  1. On job start, load the latest checkpoint.
  2. Resume from that node with that state.
  3. Skip nodes that have already produced side effects (see below).
- Tool-call idempotency:
  - Before executing a tool, look up `ToolCall` rows for `(executionId, nodeName, inputHash)`.
  - If a matching `SUCCESS` exists, reuse the output.
  - If a `PENDING` or `RUNNING` exists, wait or fail-forward per policy.
- Checkpoint pruning job (daily):
  - For terminal executions, keep first + last + any `WAITING_*` checkpoints; delete the rest.

## Architecture changes

- The `AgentRunner` now delegates state persistence to the checkpointer.
- The `WorkflowsModule` reads/writes state exclusively through the checkpointer during runs.
- Add a small `Hashing` helper for `inputHash` of tool calls.

## Database changes

- Confirm the `Checkpoint` table matches `docs/database.md`.
- Add `Checkpoint.parentCheckpointId` if not already present.
- Add a helper index `(executionId, createdAt DESC)` for latest-lookup performance.

## Required API endpoints

- Optional admin: `GET /admin/executions/:id/checkpoints` for debugging.

## Acceptance criteria

- Killing the worker mid-node causes a retry that resumes from the last checkpoint.
- No tool call runs twice for the same node input hash across retries.
- Terminal executions are pruned within 24 hours to first + last + `WAITING_*`.
- Event sequences remain monotonic across a resume boundary.
- Golden test: with a mock LLM, a run interrupted twice produces the same final message as an uninterrupted run.

## Suggested reading

- LangGraph docs: checkpointers, thread state, human-in-the-loop.
- "Idempotency at scale" essays.

## Suggested exercises

1. Implement a `RedisCheckpointer` for tests and benchmark it against the Postgres one.
2. Add `stateVersion` to the state and write a migrator that upgrades v1 checkpoints to v2.
3. Force a crash by killing the worker mid-`RESPONSE_DELTA` and verify the final response is still coherent (either resume streaming or restart the `respond` node).
4. Instrument checkpoint write latency and alert when p95 exceeds 100 ms.
5. Add a `restart` admin endpoint that discards all checkpoints for an execution and re-enqueues from scratch.
