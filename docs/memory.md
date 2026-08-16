# Memory

AgentForge implements **three** memory systems. Each has a different scope, lifetime, and retrieval mechanism.

| System | Scope | Lifetime | Retrieval |
|---|---|---|---|
| Short-term | One chat | Bounded window | Read from recent messages |
| Long-term | User (or chat) | Persistent | Vector similarity + metadata |
| Agent | One execution | Bounded by execution | Read from workflow state / checkpoints |

---

## 1. Short-term memory

**Purpose:** give the LLM the most recent conversational context.

**Implementation:**

- Read the last `N` messages of a chat (configurable per agent, default 30).
- Include role, content, and lightweight metadata (e.g., which tool produced a message).
- Optionally summarize older-than-N messages into a rolling summary stored as a `Memory` row of kind `summary`.

**Trimming policy:**

- Token budget–aware: trim until the prompt fits the model's context window minus a headroom for outputs.
- Never drop the current user message.
- Prefer dropping the oldest non-summary messages first.

---

## 2. Long-term memory

**Purpose:** persist facts, preferences, and knowledge across chats.

**Stored in:** the `Memory` table, optionally with an embedding in `Embedding`.

**Kinds:**

- `preference` — user preferences (tone, language, formats).
- `fact` — durable facts about the user or their domain.
- `summary` — rolled-up summaries of past chats.
- `note` — free-form notes captured by the agent.

**Write paths:**

- Explicit tool: `save_memory(kind, content, key?)`.
- Automatic: after an execution ends, a summarizer node may extract memories.
- Manual: user creates via `POST /memories`.

**Read paths:**

- Vector similarity query, scoped by `tenantId` and `userId`.
- Filtered by `kind` and optional metadata.

**Update semantics:**

- If a memory has a stable `key`, writing with the same `key` upserts.
- Otherwise, new content becomes a new row.
- Deduplication is a background concern (see Exercises in Phase 12).

**Access policy:**

- Long-term memory is **user-scoped by default**. It follows the user across chats within a tenant.
- Cross-user or cross-tenant access is forbidden.

---

## 3. Agent memory

**Purpose:** the execution's own working memory — the workflow's evolving state, tool call history, and node-local scratch space.

**Stored in:** LangGraph state, persisted via checkpoints.

**Contents:**

- The plan.
- Retrieved document IDs.
- Retrieved memory IDs.
- Tool call trail.
- Intermediate reasoning notes (if you choose to keep any).

**Lifetime:**

- Bounded by the execution.
- Survives worker crashes through checkpointing.
- Terminal executions retain only the first and last checkpoints (see `checkpointing.md`).

**Access:**

- The workflow reads and writes it directly.
- Not exposed through the public API except for admin/debug endpoints.

---

## 4. Retrieval strategy

When the agent needs context, it can:

1. **Read short-term memory** (always).
2. **Search long-term memory** via `memory_search` tool (vector similarity + filters).
3. **Search documents** via `document_search` tool (RAG).
4. **Read agent memory** implicitly (it is state).

The workflow decides which of these to do based on the current node.

---

## 5. Writing back to memory

Two policies are common:

- **Explicit write:** the LLM must call `save_memory` intentionally.
- **Automatic summarization:** after the execution completes, a summarizer node writes a summary if the conversation exceeded a threshold.

AgentForge supports both. The agent's `memory.longTerm.writeBack` flag toggles automatic behavior.

---

## 6. Embeddings for memory

- Every long-term memory row can have an associated `Embedding` row.
- The same embedding model is used for documents and memories to keep the space consistent.
- Rebuilding embeddings after a model change is a maintenance task (see Phase 12).

---

## 7. Isolation

- Memories are always tenant-scoped.
- User-scoped memories are further filtered by `userId`.
- Chat-scoped memories (rare, mostly summaries) are filtered by `chatId`.
- No implicit cross-scope retrieval.

---

## 8. Privacy and forgetting

- Users can list and delete their memories via `GET /memories` and `DELETE /memories/:id`.
- A tenant-wide "forget me" operation cascades through all tables (documents, memories, embeddings, checkpoints, events).
- Deletion is permanent; there is no soft-delete for memories.

---

## 9. Diagram

```
                ┌───────────────────────────┐
                │        Execution           │
                │  (LangGraph state)         │
                │  ← Agent memory            │
                └──────────────┬─────────────┘
                               │
                               ▼
      ┌───────────────┐  ┌───────────────┐  ┌───────────────┐
      │ Short-term    │  │ Long-term     │  │ Documents     │
      │ (last N msgs) │  │ (Memory +     │  │ (Embedding)   │
      │               │  │ Embedding)    │  │               │
      └───────────────┘  └───────────────┘  └───────────────┘
```
