# Database Design

AgentForge uses **PostgreSQL** as its single source of truth, with the **`pgvector`** extension for embeddings. Access is mediated by **Prisma**. This document specifies the schema, relationships, indexes, and multi-tenant isolation strategy.

> This is a design document. It does not contain Prisma schema code. Use it as the blueprint when you write the schema in Phase 2.

---

## 1. Design principles

1. **Every row is tenant-scoped.** Every table (except `Tenant` and `User` bootstrap tables) carries a `tenantId`.
2. **Append-only where possible.** `Event` and `Checkpoint` tables never update rows; they only insert.
3. **Foreign keys are enforced.** No orphan messages, no orphan executions.
4. **Indexes follow query patterns.** Every listing endpoint has a supporting index.
5. **UUIDs everywhere.** All primary keys are UUID v4.
6. **Timestamps are `TIMESTAMPTZ`.** Always store UTC.

---

## 2. Entity overview

```
Tenant ──┐
         ├── User ──┐
         │         ├── Chat ──┬── Message
         │         │          └── Execution ──┬── Event
         │         │                          ├── ToolCall
         │         │                          ├── Checkpoint
         │         │                          └── Approval
         │         └── Memory (long-term)
         ├── Document ── Embedding
         └── ...
```

---

## 3. Tables

### 3.1 `Tenant`

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` PK | |
| `name` | `TEXT` | Display name |
| `slug` | `TEXT` UNIQUE | URL-safe identifier |
| `plan` | `TEXT` | e.g. `free`, `pro` |
| `settings` | `JSONB` | Feature flags, quotas |
| `createdAt` | `TIMESTAMPTZ` | |
| `updatedAt` | `TIMESTAMPTZ` | |

Indexes: `slug` unique.

### 3.2 `User`

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` PK | |
| `tenantId` | `UUID` FK → `Tenant.id` | |
| `email` | `TEXT` | Unique per tenant |
| `passwordHash` | `TEXT` | bcrypt/argon2 |
| `displayName` | `TEXT` | |
| `role` | `TEXT` | e.g. `owner`, `member` |
| `createdAt` | `TIMESTAMPTZ` | |
| `updatedAt` | `TIMESTAMPTZ` | |

Indexes: `(tenantId, email)` unique, `tenantId`.

### 3.3 `Chat`

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` PK | |
| `tenantId` | `UUID` FK | |
| `userId` | `UUID` FK → `User.id` | |
| `title` | `TEXT` | Auto-generated or renamed |
| `agentId` | `UUID` FK → `Agent.id` | Which agent this chat uses |
| `archivedAt` | `TIMESTAMPTZ` NULL | Soft-delete |
| `createdAt` | `TIMESTAMPTZ` | |
| `updatedAt` | `TIMESTAMPTZ` | |

Indexes: `(tenantId, userId, updatedAt DESC)`, `(tenantId, archivedAt)`.

### 3.4 `Message`

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` PK | |
| `tenantId` | `UUID` FK | |
| `chatId` | `UUID` FK → `Chat.id` | Cascade delete |
| `executionId` | `UUID` FK → `Execution.id` NULL | Set for assistant messages |
| `role` | `TEXT` | `user` \| `assistant` \| `system` \| `tool` |
| `content` | `TEXT` | Final text (may be empty until streaming ends) |
| `metadata` | `JSONB` | Token counts, model name, timing |
| `createdAt` | `TIMESTAMPTZ` | |

Indexes: `(chatId, createdAt)`, `tenantId`.

### 3.5 `Execution`

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` PK | |
| `tenantId` | `UUID` FK | |
| `chatId` | `UUID` FK → `Chat.id` | |
| `userId` | `UUID` FK → `User.id` | |
| `agentId` | `UUID` FK → `Agent.id` | |
| `workflowVersion` | `TEXT` | Graph version identifier |
| `status` | `TEXT` | See enum below |
| `inputMessageId` | `UUID` FK → `Message.id` | The user message that started it |
| `outputMessageId` | `UUID` FK → `Message.id` NULL | The assistant message it produces |
| `error` | `JSONB` NULL | Error details if `FAILED` |
| `startedAt` | `TIMESTAMPTZ` NULL | |
| `finishedAt` | `TIMESTAMPTZ` NULL | |
| `createdAt` | `TIMESTAMPTZ` | |
| `updatedAt` | `TIMESTAMPTZ` | |

Status enum: `CREATED`, `QUEUED`, `RUNNING`, `THINKING`, `WAITING_FOR_USER`, `WAITING_FOR_APPROVAL`, `COMPLETED`, `FAILED`, `CANCELLED`.

Indexes: `(tenantId, chatId, createdAt DESC)`, `(status, updatedAt)` for worker sweeps.

### 3.6 `Event`

Append-only log of everything that happens inside an execution. This is what powers SSE replay.

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` PK | |
| `tenantId` | `UUID` FK | |
| `executionId` | `UUID` FK → `Execution.id` | Cascade delete |
| `sequence` | `BIGINT` | Monotonic per execution |
| `type` | `TEXT` | See SSE event contract |
| `payload` | `JSONB` | Event-specific data |
| `createdAt` | `TIMESTAMPTZ` | |

Indexes: `(executionId, sequence)` unique, `(tenantId, executionId, createdAt)`.

### 3.7 `Checkpoint`

Snapshots of LangGraph state after every significant node.

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` PK | |
| `tenantId` | `UUID` FK | |
| `executionId` | `UUID` FK → `Execution.id` | Cascade delete |
| `nodeName` | `TEXT` | Which node produced this checkpoint |
| `state` | `JSONB` | Serialized workflow state |
| `parentCheckpointId` | `UUID` FK → `Checkpoint.id` NULL | For branching |
| `createdAt` | `TIMESTAMPTZ` | |

Indexes: `(executionId, createdAt DESC)`, `(tenantId, executionId)`.

### 3.8 `ToolCall`

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` PK | |
| `tenantId` | `UUID` FK | |
| `executionId` | `UUID` FK → `Execution.id` | |
| `toolName` | `TEXT` | Registered tool identifier |
| `input` | `JSONB` | Validated against tool schema |
| `output` | `JSONB` NULL | Populated on success |
| `status` | `TEXT` | `PENDING` \| `RUNNING` \| `SUCCESS` \| `ERROR` \| `CANCELLED` |
| `error` | `JSONB` NULL | |
| `startedAt` | `TIMESTAMPTZ` NULL | |
| `finishedAt` | `TIMESTAMPTZ` NULL | |
| `createdAt` | `TIMESTAMPTZ` | |

Indexes: `(executionId, createdAt)`, `(tenantId, toolName, status)`.

### 3.9 `Approval`

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` PK | |
| `tenantId` | `UUID` FK | |
| `executionId` | `UUID` FK → `Execution.id` | |
| `toolCallId` | `UUID` FK → `ToolCall.id` NULL | If approving a specific tool call |
| `reason` | `TEXT` | Why approval is needed |
| `payload` | `JSONB` | What the agent wants to do |
| `status` | `TEXT` | `PENDING` \| `APPROVED` \| `REJECTED` \| `EXPIRED` |
| `decidedBy` | `UUID` FK → `User.id` NULL | |
| `decidedAt` | `TIMESTAMPTZ` NULL | |
| `expiresAt` | `TIMESTAMPTZ` NULL | |
| `createdAt` | `TIMESTAMPTZ` | |

Indexes: `(executionId, status)`, `(tenantId, status, createdAt)`.

### 3.10 `Memory`

Long-term memory items (facts, preferences, saved knowledge).

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` PK | |
| `tenantId` | `UUID` FK | |
| `userId` | `UUID` FK → `User.id` NULL | Scope: user-level |
| `chatId` | `UUID` FK → `Chat.id` NULL | Scope: chat-level (agent memory) |
| `kind` | `TEXT` | `preference` \| `fact` \| `summary` \| `note` |
| `key` | `TEXT` NULL | Optional stable key for upsert |
| `content` | `TEXT` | Human-readable memory |
| `embeddingId` | `UUID` FK → `Embedding.id` NULL | For retrieval |
| `metadata` | `JSONB` | Source, confidence, timestamps |
| `createdAt` | `TIMESTAMPTZ` | |
| `updatedAt` | `TIMESTAMPTZ` | |

Indexes: `(tenantId, userId, kind)`, `(tenantId, chatId, kind)`, `(tenantId, key)`.

### 3.11 `Document`

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` PK | |
| `tenantId` | `UUID` FK | |
| `userId` | `UUID` FK → `User.id` | Uploader |
| `title` | `TEXT` | |
| `mimeType` | `TEXT` | `application/pdf`, `text/plain`, `text/markdown` |
| `sizeBytes` | `BIGINT` | |
| `storageKey` | `TEXT` | Path in object storage |
| `status` | `TEXT` | `UPLOADED` \| `PROCESSING` \| `INDEXED` \| `FAILED` |
| `createdAt` | `TIMESTAMPTZ` | |
| `updatedAt` | `TIMESTAMPTZ` | |

Indexes: `(tenantId, userId, createdAt DESC)`, `(tenantId, status)`.

### 3.12 `Embedding`

Uses `pgvector`. One row per chunk.

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` PK | |
| `tenantId` | `UUID` FK | |
| `documentId` | `UUID` FK → `Document.id` NULL | Null for memory embeddings |
| `memoryId` | `UUID` FK → `Memory.id` NULL | Null for document chunks |
| `chunkIndex` | `INT` | Position in source |
| `content` | `TEXT` | The chunk text |
| `embedding` | `VECTOR(1536)` | Dimension matches your embedding model |
| `metadata` | `JSONB` | Page number, section, source URL |
| `createdAt` | `TIMESTAMPTZ` | |

Indexes:
- `(tenantId, documentId, chunkIndex)`
- `ivfflat` or `hnsw` index on `embedding` scoped by `tenantId` (partial index or filter at query time)

### 3.13 `Agent`

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` PK | |
| `tenantId` | `UUID` FK NULL | Null for global built-in agents |
| `name` | `TEXT` | |
| `description` | `TEXT` | |
| `systemPrompt` | `TEXT` | |
| `model` | `TEXT` | e.g. `gpt-4o`, `claude-opus-4` |
| `temperature` | `NUMERIC` | |
| `tools` | `TEXT[]` | Allowed tool names |
| `workflowVersion` | `TEXT` | Which graph to run |
| `createdAt` | `TIMESTAMPTZ` | |
| `updatedAt` | `TIMESTAMPTZ` | |

Indexes: `(tenantId, name)` unique.

---

## 4. Relationships summary

- `Tenant` 1—N `User`
- `Tenant` 1—N `Agent`
- `User` 1—N `Chat`
- `Chat` 1—N `Message`
- `Chat` 1—N `Execution`
- `Execution` 1—N `Event`
- `Execution` 1—N `Checkpoint`
- `Execution` 1—N `ToolCall`
- `Execution` 1—N `Approval`
- `Document` 1—N `Embedding`
- `Memory` 1—1 `Embedding` (optional)

Cascade rules:

- Deleting a `Chat` cascades to `Message`, `Execution`, and through executions to `Event`, `Checkpoint`, `ToolCall`, `Approval`.
- Deleting a `Document` cascades to its `Embedding` rows.
- Deleting a `Tenant` cascades to everything owned by it (guarded by an explicit admin flow).

---

## 5. Multi-tenant isolation

Every table carries `tenantId`. Two layers enforce isolation:

1. **Application layer.** A `TenantContext` is derived from the JWT and injected into every repository call. Every query includes `where: { tenantId }`.
2. **Database layer.** Optional but recommended: PostgreSQL **Row-Level Security (RLS)** policies on every tenant-owned table using a session variable set at connection acquisition.

Guidelines:

- Never expose raw IDs across tenants (URLs are still tenant-scoped via the auth middleware).
- Never use `findFirst` without `tenantId`.
- Cross-tenant admin queries live in a separate, explicit admin module with its own audit trail.

---

## 6. Vector search

Similarity search is scoped per tenant.

```
SELECT id, content, metadata
FROM "Embedding"
WHERE tenantId = $1
  AND documentId = ANY($2)     -- optional filter
ORDER BY embedding <-> $3       -- cosine or L2 depending on index
LIMIT $4;
```

Index strategy:

- Start with `ivfflat` for simplicity.
- Move to `hnsw` when recall or latency requires it.
- Rebuild indexes after significant data growth.

---

## 7. Indexes cheat-sheet

| Query | Index |
|---|---|
| List chats for a user | `(tenantId, userId, updatedAt DESC)` |
| List messages in a chat | `(chatId, createdAt)` |
| Replay execution events | `(executionId, sequence)` |
| Sweep stuck executions | `(status, updatedAt)` |
| Retrieve memories by user | `(tenantId, userId, kind)` |
| Similarity search | `pgvector` index on `embedding` |
| Approval queue for user | `(tenantId, status, createdAt)` |

---

## 8. Migrations discipline

- Every change is a versioned Prisma migration.
- Never edit an applied migration.
- Backfills run as separate scripts, not inside schema migrations.
- Additive-first: add columns nullable, backfill, then make required.
