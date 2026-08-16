# API Contract

This document defines the AgentForge HTTP + SSE contract. Endpoints are grouped by resource. All routes are prefixed with `/api/v1`. All routes except `POST /auth/*` require a valid JWT.

> No implementation here. This is the contract you will implement in the phases.

---

## 1. Conventions

- **Base URL:** `/api/v1`
- **Auth:** `Authorization: Bearer <accessToken>` on every request except `/auth/register`, `/auth/login`, `/auth/refresh`.
- **Tenant:** derived from the JWT; never sent as a header by clients.
- **Content:** `application/json` for requests and responses, except SSE (`text/event-stream`) and uploads (`multipart/form-data`).
- **Pagination:** cursor-based. Query params: `?cursor=<id>&limit=<n>`. Responses include `nextCursor`.
- **Errors:** JSON body `{ error: { code, message, details? } }` with appropriate HTTP status.
- **IDs:** UUID v4.
- **Timestamps:** ISO 8601 UTC.

---

## 2. Authentication

### `POST /auth/register`
Body: `{ email, password, displayName, tenantSlug? }`
Response: `{ user, accessToken, refreshToken }`

### `POST /auth/login`
Body: `{ email, password }`
Response: `{ user, accessToken, refreshToken }`

### `POST /auth/refresh`
Body: `{ refreshToken }`
Response: `{ accessToken, refreshToken }`

### `POST /auth/logout`
Body: `{ refreshToken }`
Response: `204 No Content`

### `GET /auth/me`
Response: `{ user }`

---

## 3. Chats

### `POST /chats`
Create a chat.
Body: `{ title?, agentId }`
Response: `{ chat }`

### `GET /chats`
List chats for the current user.
Query: `?cursor&limit&includeArchived=false`
Response: `{ items: Chat[], nextCursor }`

### `GET /chats/:chatId`
Response: `{ chat, latestExecution?, messagesPreview? }`

### `PATCH /chats/:chatId`
Rename or archive.
Body: `{ title?, archivedAt? }`
Response: `{ chat }`

### `DELETE /chats/:chatId`
Soft-delete.
Response: `204 No Content`

### `POST /chats/:chatId/reopen`
Restore an archived chat.
Response: `{ chat }`

---

## 4. Messages

### `POST /chats/:chatId/messages`
Send a user message. **Creates an execution and enqueues a job.**
Body: `{ content, attachments?: [{ documentId }] }`
Response: `{ message, execution }`
The response returns immediately. The agent runs asynchronously.

### `GET /chats/:chatId/messages`
Paginated list, newest last.
Query: `?cursor&limit`
Response: `{ items: Message[], nextCursor }`

---

## 5. Executions

### `GET /executions/:executionId`
Response: `{ execution, latestEvent?, latestCheckpoint? }`

### `GET /executions/:executionId/events`
Full event log (for reconstruction after refresh).
Query: `?afterSequence&limit`
Response: `{ items: Event[], nextSequence }`

### `GET /executions/:executionId/tool-calls`
Response: `{ items: ToolCall[] }`

### `POST /executions/:executionId/cancel`
Signal cancellation. Idempotent.
Response: `{ execution }` (status may still be `RUNNING` until the worker observes the signal)

### `GET /chats/:chatId/executions`
List all executions in a chat.
Response: `{ items: Execution[], nextCursor }`

---

## 6. Streaming (SSE)

### `GET /executions/:executionId/stream`
Content-Type: `text/event-stream`

Behavior:
1. On connect, the server sends a `CONNECTED` event with the current status and sequence cursor.
2. The server **replays** all persisted events with `sequence > lastEventId` (from the `Last-Event-ID` header if present).
3. The server then **subscribes** to Redis pub/sub and forwards new events live.
4. The server sends periodic heartbeats (`: ping`) to keep the connection open.
5. On terminal status (`COMPLETED`, `FAILED`, `CANCELLED`), the server sends the final event and closes the stream.

Client reconnect:
- The client sends `Last-Event-ID: <sequence>` on reconnect.
- The server resumes from that sequence.

See `docs/streaming.md` for the full event contract.

---

## 7. Approvals (human-in-the-loop)

### `GET /approvals`
List pending approvals for the current user.
Query: `?status=PENDING&cursor&limit`
Response: `{ items: Approval[], nextCursor }`

### `GET /approvals/:approvalId`
Response: `{ approval }`

### `POST /approvals/:approvalId/decision`
Body: `{ decision: 'APPROVED' | 'REJECTED', note? }`
Response: `{ approval }`
Effect: the worker observing the approval will resume or terminate the workflow.

---

## 8. Documents (RAG source)

### `POST /documents`
Upload a document. `multipart/form-data` with fields `file` and optional `title`.
Response: `{ document }` with status `UPLOADED`. Indexing runs asynchronously.

### `GET /documents`
Query: `?cursor&limit&status`
Response: `{ items: Document[], nextCursor }`

### `GET /documents/:documentId`
Response: `{ document, chunks?: { count } }`

### `DELETE /documents/:documentId`
Removes the document and its embeddings.
Response: `204 No Content`

### `POST /documents/:documentId/reindex`
Re-runs chunking + embeddings.
Response: `{ document }`

---

## 9. Memory

### `GET /memories`
Query: `?userId?&chatId?&kind?&cursor&limit`
Response: `{ items: Memory[], nextCursor }`

### `POST /memories`
Manually add a memory.
Body: `{ userId?, chatId?, kind, key?, content, metadata? }`
Response: `{ memory }`

### `PATCH /memories/:memoryId`
Body: `{ content?, metadata? }`
Response: `{ memory }`

### `DELETE /memories/:memoryId`
Response: `204 No Content`

---

## 10. Agents

### `GET /agents`
List agents available to the current tenant.
Response: `{ items: Agent[] }`

### `GET /agents/:agentId`
Response: `{ agent }`

Agent creation and editing are administrative and covered later.

---

## 11. Tenants (admin)

### `GET /tenants/me`
Response: `{ tenant }`

### `PATCH /tenants/me`
Body: `{ name?, settings? }`
Response: `{ tenant }`

---

## 12. Error codes

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Body failed DTO validation |
| 401 | `UNAUTHENTICATED` | Missing or invalid token |
| 403 | `FORBIDDEN` | Authenticated but not allowed |
| 404 | `NOT_FOUND` | Resource missing or not visible in tenant |
| 409 | `CONFLICT` | State transition invalid (e.g. cancelling a completed execution) |
| 413 | `PAYLOAD_TOO_LARGE` | Upload too big |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Unsupported document type |
| 422 | `SEMANTIC_ERROR` | Valid DTO but rejected by business rules |
| 429 | `RATE_LIMITED` | Rate limit exceeded |
| 500 | `INTERNAL_ERROR` | Unexpected failure |
| 503 | `DEPENDENCY_UNAVAILABLE` | LLM, Redis, or DB unavailable |

---

## 13. Rate limiting

- Global: per user, per IP.
- Per endpoint: message send, document upload, and stream connect have their own budgets.
- Enforced by an Express middleware backed by Redis (token bucket).

---

## 14. Idempotency

- `POST /chats/:chatId/messages` accepts `Idempotency-Key` header. Repeated requests with the same key return the original response.
- `POST /executions/:executionId/cancel` is naturally idempotent.
