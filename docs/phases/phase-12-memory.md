# Phase 12 — Memory

## Overview

Implement the three memory systems described in `docs/memory.md`: short-term (recent messages), long-term (persisted facts and preferences), and agent (execution state via checkpoints). Wire memory retrieval into the workflow and provide APIs for users to inspect and manage their memories.

## Learning objectives

- Implement retrieval-aware prompting with a bounded token budget.
- Persist and retrieve long-term memories with vector similarity + metadata filters.
- Automatically extract memories from completed conversations.
- Expose memory as a first-class user-visible resource.

## Concepts to study

- Rolling summaries and how they compress long conversations.
- Similarity search with metadata filters in `pgvector`.
- Memory extraction: prompting an LLM to identify durable facts.
- Consent and privacy for stored memories.

## Features to implement

- `MemoryModule`:
  - `save_memory` tool: LLM-callable, writes a `Memory` row and its embedding.
  - `memory_search` tool: retrieves top-K memories for a query, scoped by tenant + user.
  - `GET/POST/PATCH/DELETE /memories` endpoints from `docs/api.md`.
- Short-term memory:
  - `ShortTermMemoryService.buildContext(chatId, budgetTokens)` returns the last N messages + optional rolling summary.
- Long-term memory:
  - Automatic extraction: after `COMPLETED`, a `summarizer` node identifies candidate memories and writes them.
  - Deduplication: if a new memory is highly similar to an existing one (cosine > threshold), merge instead of insert.
- Agent memory:
  - Already covered by checkpointing; expose an admin endpoint `GET /admin/executions/:id/state` for debugging.

## Architecture changes

- Add memory retrieval as a workflow node (`retrieveMemory`) or a step inside `plan`.
- Update the prompt template to include a "Long-term memory" section when relevant memories are found.
- Add a `SummarizerService` used by the `summarizer` node.

## Database changes

- Confirm `Memory` and `Embedding` tables.
- Add index `(tenantId, userId, kind)` on `Memory`.
- Add optional `Memory.key` unique per `(tenantId, userId, key)` for upsert semantics.

## Required API endpoints

See Section 9 of `docs/api.md`.

## Acceptance criteria

- The agent can save and retrieve memories through tools.
- After a chat, at most K high-quality memories are auto-extracted (configurable, default 3).
- Similar memories are merged rather than duplicated.
- The user can list, edit, and delete their memories.
- Deleting a memory removes its embedding row too.
- Cross-user memory retrieval is impossible.

## Suggested reading

- "Generative Agents" (Park et al.) — memory streams and reflection.
- LangChain memory abstractions (as reference, not required).
- Vector deduplication techniques.

## Suggested exercises

1. Add a "reflection" step that periodically summarizes older memories into higher-level insights.
2. Add memory tagging and filter retrieval by tags.
3. Add a `GET /memories/timeline` endpoint that returns memories with `createdAt` clusters.
4. Add a nightly job that decays low-value memories (never referenced, low confidence) after N days.
5. Add a "forget everything about X" endpoint that deletes memories matching a semantic query, with a preview + confirm flow.
