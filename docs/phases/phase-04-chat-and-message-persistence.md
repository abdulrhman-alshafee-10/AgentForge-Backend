# Phase 04 — Chat and Message Persistence

## Overview

Model chats and messages as first-class, persistent entities. A user can create chats, list them, rename them, archive/reopen them, and post messages that are stored permanently. Executions are introduced here as records only; they will not run anything until Phase 09.

## Learning objectives

- Model conversation state with clear separation between `Chat`, `Message`, and `Execution`.
- Implement cursor-based pagination correctly.
- Handle soft-delete (archive) semantics and reopen flows.
- Keep the controller thin and business rules in the service.

## Concepts to study

- Aggregate design: chat as the aggregate root of messages and executions.
- Cursor pagination vs offset pagination and why cursor wins at scale.
- Optimistic concurrency for renames and archives.
- Idempotency keys on message send.

## Features to implement

- `ChatsModule`:
  - `POST /chats`, `GET /chats`, `GET /chats/:id`, `PATCH /chats/:id`, `DELETE /chats/:id`, `POST /chats/:id/reopen`.
- `MessagesModule`:
  - `POST /chats/:id/messages` (creates the user message + a `CREATED` `Execution`; does not run anything yet).
  - `GET /chats/:id/messages` with cursor pagination.
- `ExecutionsModule` (read-only for now):
  - `GET /executions/:id`, `GET /chats/:id/executions`.
- Auto-title chats using the first user message (simple truncation heuristic; LLM titling comes later).
- Enforce tenant + user ownership on every route via middleware.
- Support `Idempotency-Key` on `POST /messages`.

## Architecture changes

- Introduce `ChatsRepository`, `MessagesRepository`, `ExecutionsRepository`.
- Add a `chatOwnership` middleware used by every chat-scoped route (loads the chat by `:chatId`, asserts tenant + user match, attaches `req.chat`).
- Add pagination helpers in `common/`.

## Database changes

- Confirm indexes: `(chatId, createdAt)` on `Message`, `(tenantId, userId, updatedAt DESC)` on `Chat`.
- Add `Chat.archivedAt` if not present.
- Add an `IdempotencyKey` table (or Redis-backed key) if you choose to persist keys.

## Required API endpoints

See Sections 3, 4, 5 of `docs/api.md`.

## Acceptance criteria

- A user can create a chat, post messages, and list them in order.
- Renaming a chat updates `title` and `updatedAt`.
- Archiving hides a chat by default; `?includeArchived=true` shows it.
- Reopening clears `archivedAt`.
- Cross-user or cross-tenant access returns 404 (not 403, to avoid leaking existence).
- Duplicate `POST /messages` with the same `Idempotency-Key` returns the same response.

## Suggested reading

- "Pagination — the great debate" (cursor pagination articles).
- HTTP idempotency semantics (RFC 7231, Stripe's idempotency-key docs).

## Suggested exercises

1. Add an endpoint to search chats by title with `ILIKE`.
2. Add a `Chat.summary` column and populate it after N messages (stub the summarizer; wire it in Phase 12).
3. Track `Chat.lastMessageAt` and use it as the sort key for listing.
4. Add a test that verifies `Idempotency-Key` returns identical responses even under concurrent requests.
5. Emit domain events (`ChatCreated`, `MessagePosted`) via an in-memory event bus for future subscribers.
