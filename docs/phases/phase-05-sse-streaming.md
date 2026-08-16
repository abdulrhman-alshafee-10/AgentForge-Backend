# Phase 05 — SSE Streaming

## Overview

Introduce Server-Sent Events. Build the `/executions/:id/stream` endpoint end-to-end: authentication, replay from persisted events, live subscription via Redis pub/sub, heartbeats, and clean termination. No agent work yet; a stub producer emits fake events so the pipeline can be tested.

## Learning objectives

- Understand SSE at the protocol level: `text/event-stream`, event framing, `Last-Event-ID`.
- Combine **replay** and **live subscribe** to make streams resumable.
- Handle backpressure, heartbeats, and disconnects gracefully.
- Persist every event to PostgreSQL before publishing to Redis.

## Concepts to study

- SSE vs WebSockets: trade-offs, when to pick which.
- Redis pub/sub semantics and its at-most-once delivery.
- Writing SSE by hand in Express: setting `Content-Type: text/event-stream`, disabling response buffering, calling `res.write` for each frame, and handling `req.on('close')`.
- Sequence numbers and monotonic ordering per execution.

## Features to implement

- `modules/streaming/` with `GET /executions/:id/stream` implemented as a plain Express handler that writes SSE frames directly to `res`.
- `EventsService` (`modules/executions/events.service.ts`):
  - `appendEvent(executionId, type, payload)` — allocates the next `sequence` atomically, writes to the `Event` table, then publishes to Redis channel `execution:<id>`.
- Stream handler responsibilities:
  - Run through `authenticate` + `requireOwnership` middleware.
  - Read `Last-Event-ID` header (fallback: `?lastEventId=` query).
  - Set headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no`.
  - Replay events with `sequence > lastEventId` from `Event`.
  - Subscribe to Redis pub/sub for the execution channel.
  - Emit `: ping\n\n` heartbeats every 15 seconds via `setInterval`, cleared on close.
  - Detect client disconnect via `req.on('close')` and unsubscribe.
  - Close on terminal events (`COMPLETED`, `FAILED`, `CANCELLED`).
- A stub producer (a debug endpoint or CLI script) that emits a scripted sequence of events for a fake execution.

## Architecture changes

- Add `modules/streaming/` and an `EventsService` (in `modules/executions/`).
- Introduce a Redis client singleton at `src/redis/redis.ts` (using `ioredis`). Create a **separate** connection for pub/sub subscribers (Redis requires this).
- Extend the Zod config schema with `REDIS_URL`.

## Database changes

- Confirm `Event.sequence` uniqueness per execution.
- Add a helper that computes `nextSequence(executionId)` atomically (e.g., row-level lock or a Postgres sequence per execution — a `MAX(sequence)+1` inside a transaction works for now).

## Required API endpoints

- `GET /executions/:id/stream` (SSE).
- `GET /executions/:id/events` (paginated event list, used for cold reconstruction).

## Acceptance criteria

- Streaming a fake execution replays all past events, then live-forwards new ones.
- Reconnecting with `Last-Event-ID` resumes without gaps or duplicates.
- Heartbeats keep the connection alive through a 60s idle window.
- Terminal events close the stream cleanly.
- The Redis client failing does not lose events (they are still in Postgres and available via cold fetch).

## Suggested reading

- HTML Living Standard: Server-Sent Events section.
- Redis pub/sub documentation.
- MDN: Using Server-Sent Events.
- `ioredis` pub/sub docs (separate subscriber connection requirement).

## Suggested exercises

1. Implement client reconnect logic in a small script and prove no event loss.
2. Add a stream metric: emitted events/sec per execution.
3. Support `?format=jsonl` on `/events` for tools that prefer newline-delimited JSON.
4. Add a per-tenant maximum number of concurrent streams and enforce it.
5. Replace Redis pub/sub with Redis Streams and note the reliability differences.
