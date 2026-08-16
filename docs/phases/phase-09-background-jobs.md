# Phase 09 — Background Jobs

## Overview

Move agent execution **out of the HTTP request** and into a worker process backed by **Redis + BullMQ**. HTTP creates jobs; workers consume them. This is the phase where the "backend keeps running when the browser closes" promise becomes true.

## Learning objectives

- Design a queue architecture with retries, backoff, and dead-letter handling.
- Split the app into API and worker processes with shared modules.
- Coordinate cancellation across HTTP and worker boundaries.
- Understand at-least-once delivery and idempotency.

## Concepts to study

- Redis data model and BullMQ concepts: queues, workers, jobs, repeatable jobs, flows.
- Job options: attempts, backoff, timeouts, priorities.
- Graceful shutdown for workers.
- Distributed cancellation patterns (flags in Redis, DB-driven checks).

## Features to implement

- `QueuesModule`:
  - Queue definition: `executions`.
  - Producer: `enqueueExecution(executionId)`.
  - Worker: `ExecutionWorker` that runs the LangGraph workflow from Phase 08 for the given execution.
- Two runnable entry points:
  - `main.ts` for the API server.
  - `worker.ts` for the worker process (shares modules, boots minimal services: DB, Redis, workflows, streaming producer).
- Cancellation:
  - `POST /executions/:id/cancel` sets a Redis flag and updates DB.
  - Worker checks the flag between nodes and on tool boundaries; on cancel, it emits `CANCELLED` and stops.
- Retry policy:
  - Default: 3 attempts with exponential backoff.
  - Non-retryable errors (`VALIDATION_ERROR`, cancellation) are marked terminal immediately.
- Dead-letter handling:
  - Failed jobs move to a `failed` state in BullMQ; a small admin endpoint lists them.

## Architecture changes

- The `AgentRunner` moves from an in-process caller to the worker.
- The API route `POST /chats/:id/messages` now:
  1. Creates the message + execution.
  2. Enqueues a job.
  3. Returns immediately.
- Introduce a `WorkerBootstrap` module that composes only what the worker needs.

## Database changes

- Add `Execution.attempts` counter (optional, useful for observability).
- Confirm `(status, updatedAt)` index for stuck-execution sweeps.

## Required API endpoints

- `POST /executions/:id/cancel` (implemented from `docs/api.md`, now fully functional).
- Internal: no new endpoints.

## Acceptance criteria

- Killing the API server has zero impact on running executions.
- Killing a worker mid-execution causes retries and eventual completion or `FAILED` (recovery from checkpoints comes in Phase 10; here you may allow full restarts).
- Cancelling a running execution results in `CANCELLED` within a bounded time (≤ 5 s in tests).
- The API cannot block on agent work.
- Redis outage does not corrupt state; jobs pile up in the DB (`CREATED`) until Redis returns.

## Suggested reading

- BullMQ docs: Queues, Workers, Jobs, Flows, Retries.
- Redis docs: keyspace notifications, TTL.
- "Idempotent workers" essays and articles.

## Suggested exercises

1. Add a `stuck execution` sweeper: any `RUNNING` execution with no events for 5 minutes is re-enqueued.
2. Add BullMQ metrics: waiting, active, delayed, failed. Expose them at `/admin/queues`.
3. Add job prioritization: paid tenants get a higher priority.
4. Test the system by killing the worker every 2 seconds during a run and verifying eventual completion.
5. Add graceful shutdown that finishes the current node before exiting.
