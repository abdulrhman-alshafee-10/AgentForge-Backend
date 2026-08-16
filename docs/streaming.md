# Streaming (SSE)

AgentForge uses **Server-Sent Events (SSE)** to push agent progress to the client. SSE is unidirectional, works over standard HTTP, is easy to proxy, and pairs naturally with an append-only event log.

> Reminder: SSE is a **delivery** mechanism. The database is the source of truth. Every event is persisted before being streamed.

---

## 1. Endpoint

```
GET /api/v1/executions/:executionId/stream
Accept: text/event-stream
```

Headers of interest:

- `Authorization: Bearer <accessToken>` — required.
- `Last-Event-ID: <sequence>` — optional, used for resume.
- `Cache-Control: no-cache` — client should set.

---

## 2. Connection lifecycle

```
Client GET /stream
       │
       ▼
Server authenticates + authorizes (tenant + execution ownership)
       │
       ▼
Server sends CONNECTED event with current status
       │
       ▼
Server replays persisted events with sequence > Last-Event-ID
       │
       ▼
Server subscribes to Redis pub/sub channel `execution:<id>`
       │
       ▼
Server forwards new events as they arrive
       │
       ▼
On terminal status (COMPLETED / FAILED / CANCELLED):
       Server emits terminal event and closes stream
```

The server sends a comment line (`: ping\n\n`) every 15 seconds to keep intermediaries from timing out the connection.

---

## 3. SSE frame format

Every event is emitted as:

```
id: <sequence>
event: <TYPE>
data: <JSON payload>

```

Blank line terminates the frame.

- `id` is the monotonic per-execution sequence from the `Event` table.
- `event` is the event type (see contract below).
- `data` is a JSON object with event-specific fields.

---

## 4. Event contract

All events share a common envelope inside `data`:

```
{
  "executionId": "uuid",
  "chatId": "uuid",
  "sequence": 42,
  "occurredAt": "2026-08-15T13:00:00.000Z",
  "type": "PLANNING",
  "payload": { ... }
}
```

### 4.1 Supported event types

| Type | When | Payload |
|---|---|---|
| `CONNECTED` | On SSE connect | `{ status, lastSequence }` |
| `PLANNING` | Planner node starts | `{ note?: string }` |
| `THINKING` | LLM call in progress | `{ node, tokens? }` |
| `RETRIEVING_DOCUMENTS` | RAG retrieval | `{ query, k }` |
| `DOCUMENTS_RETRIEVED` | Retrieval finished | `{ documentIds, chunkIds }` |
| `SEARCHING_MEMORY` | Memory retrieval | `{ scope, query }` |
| `MEMORY_RETRIEVED` | Memory retrieval finished | `{ memoryIds }` |
| `CALLING_TOOL` | Tool call requested by LLM | `{ toolCallId, toolName, input }` |
| `EXECUTING_TOOL` | Tool started | `{ toolCallId }` |
| `TOOL_RESULT` | Tool finished | `{ toolCallId, status, output?, error? }` |
| `WAITING_FOR_APPROVAL` | Approval gate reached | `{ approvalId, reason, payload }` |
| `APPROVAL_DECISION` | User decided | `{ approvalId, decision }` |
| `GENERATING_RESPONSE` | Final generation started | `{ node }` |
| `RESPONSE_DELTA` | Partial text chunk | `{ text }` |
| `RESPONSE_COMPLETED` | Assistant message finalized | `{ messageId }` |
| `STATUS` | Status change | `{ status }` |
| `COMPLETED` | Execution finished | `{ messageId, durationMs }` |
| `FAILED` | Execution failed | `{ error }` |
| `CANCELLED` | Execution cancelled | `{ reason? }` |

`STATUS` events fire on every state machine transition. They complement the fine-grained events above.

---

## 5. Persistence rules

- Every event is inserted into the `Event` table **before** being published to Redis.
- The `sequence` is generated atomically per execution.
- The publish to Redis is best-effort; if it fails, the event is still available via replay.

---

## 6. Replay and recovery

The refresh scenario:

```
1. User is watching an execution.
2. User refreshes the page.
3. Frontend calls GET /executions/:id and GET /chats/:id
4. Frontend receives current status, messages, and event history.
5. If status ∈ { RUNNING, THINKING, WAITING_* }:
     Frontend opens GET /executions/:id/stream with Last-Event-ID = <last known sequence>
     Server replays missed events, then subscribes to live.
```

This works because:

- Events are append-only.
- Events have monotonic sequence numbers.
- Events include enough payload to reconstruct the UI.

---

## 7. Response streaming (partial text)

The `RESPONSE_DELTA` event streams token-level or chunk-level text as the LLM produces it. The frontend appends deltas to the current assistant message.

- Deltas are also **persisted** as events, so refresh + replay reconstructs the streaming animation faithfully (or the final content, if the client chooses to skip deltas).
- The final `RESPONSE_COMPLETED` event carries the `messageId` whose `content` column now holds the full text.

---

## 8. Cancellation

Cancellation is a **signal**, not a hang-up.

```
POST /executions/:id/cancel
   ↓
Server sets a cancel flag in Redis + Execution.status stays RUNNING briefly
   ↓
Worker checks the flag between nodes / tool calls
   ↓
Worker saves a checkpoint
   ↓
Worker emits CANCELLED event
   ↓
Server closes the SSE stream
```

The user's UI reflects the transition through the streamed `STATUS` and `CANCELLED` events.

---

## 9. Backpressure and limits

- Max 1 active stream per `(user, execution)` pair; additional connects replace older ones with a `409 CONFLICT` unless the client explicitly wants multiple viewers.
- Idle streams are closed after 5 minutes with no events.
- Heartbeats every 15 seconds.
- Server-side buffer per stream is bounded; slow consumers get disconnected with a `408`.

---

## 10. Security

- The stream endpoint enforces tenant + user ownership of the execution.
- Tokens are validated on connect; a refreshed token requires a reconnect.
- No sensitive tool inputs are streamed unless the tool declares them safe to stream.

---

## 11. Client contract summary

To be a correct AgentForge client:

1. On chat open: fetch messages, latest execution, and last events.
2. If execution is non-terminal: open SSE with `Last-Event-ID`.
3. Update UI from events (do not derive state from HTTP alone).
4. On disconnect: reconnect with `Last-Event-ID` up to a bounded number of retries with backoff.
5. Do not assume the stream is the only source of truth; the API is.
