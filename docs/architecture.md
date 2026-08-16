# Architecture

AgentForge is designed around one central idea: **the agent is a long-running, persistent process** that must survive network drops, browser closes, and server restarts. Every architectural choice serves that goal.

---

## 1. High-level topology

```
┌──────────────┐   HTTP + SSE   ┌───────────────────────┐
│   Frontend   │ ─────────────► │  Express API server   │
└──────────────┘ ◄───────────── │  (stateless, scalable)│
                                └──────────┬─────────────┘
                                           │ enqueue / read
                                           ▼
                                  ┌────────────────┐
                                  │   Redis + BullMQ│
                                  └────────┬────────┘
                                           │ pop job
                                           ▼
                                  ┌────────────────┐        ┌───────────────┐
                                  │  Agent Worker  │───────►│ LLM / Tools   │
                                  │  (LangGraph)   │        └───────────────┘
                                  └───┬────────┬───┘
                                      │        │
                                      ▼        ▼
                              ┌─────────────┐  ┌───────────────┐
                              │ PostgreSQL  │  │ pgvector store│
                              │ (state,     │  │ (embeddings)  │
                              │ events,     │  └───────────────┘
                              │ checkpoints)│
                              └─────────────┘
```

Key properties:

- **API server is stateless.** It can scale horizontally.
- **Worker processes** own execution. They pull jobs, run LangGraph, and persist state.
- **PostgreSQL is the source of truth** for chats, executions, events, checkpoints, and memories.
- **Redis** carries transient signals (cancel, pub/sub for SSE fan-out) and BullMQ queues.
- **pgvector** lives inside PostgreSQL to keep RAG data collocated with tenant data.

---

## 2. Separation of HTTP and execution

The most important architectural rule: **HTTP handlers never run agent logic.**

| HTTP is responsible for | HTTP must never do |
|---|---|
| Create executions | Call the LLM |
| Read state | Run tools |
| Subscribe to SSE | Perform embeddings |
| Cancel workflows | Block on long tasks |

The worker is responsible for all AI work. This is what makes agents survive page refreshes: there is no HTTP request holding the agent.

---

## 3. Request lifecycle

### 3.1 Sending a message

```
POST /chats/:chatId/messages
  ↓
Message stored (role=user)
  ↓
Execution created (status=CREATED)
  ↓
Job enqueued in BullMQ (status=QUEUED)
  ↓
Response returned immediately with { executionId }
```

The HTTP request ends here. The agent has not started yet from the client's point of view, and that is fine.

### 3.2 Subscribing to progress

```
GET /executions/:executionId/stream (SSE)
  ↓
Server:
  1. Replays all persisted events for this execution
  2. Subscribes to Redis pub/sub for new events
  3. Emits status changes and agent events
```

Replaying persisted events is what makes **page refresh recovery** work. The stream is stateless from the client's perspective.

### 3.3 Cancelling

```
POST /executions/:executionId/cancel
  ↓
Cancellation flag written to Redis + DB
  ↓
Worker checks flag at each checkpoint
  ↓
Worker saves last checkpoint
  ↓
Execution status → CANCELLED
  ↓
SSE emits CANCELLED and closes
```

---

## 4. Backend module architecture

The Express application is organized as a collection of **feature-first** modules under `src/modules/`. Each module owns its routes, controllers, services, and repositories. Cross-cutting concerns live under `src/common/`.

```
src/
├── config/          Env loading and validation (Zod)
├── common/          Errors, middleware, logger, utils, DI wiring
├── db/              Prisma client and helpers
├── redis/           Redis client (ioredis)
└── modules/
    ├── auth/            Authentication, JWT, auth middleware
    ├── users/           User accounts and profiles
    ├── chats/           Chat lifecycle (create/rename/delete/reopen)
    ├── messages/        Message CRUD, ordering, pagination
    ├── executions/      Agent runs: status, events, cancellation
    ├── agents/          Agent definitions, prompts, LLM adapters
    ├── tools/           Tool registry, schemas, safe execution
    ├── workflows/       LangGraph graphs, nodes, edges, routing
    ├── memory/          Short-term, long-term, agent memory
    ├── documents/       File ingestion, chunking pipeline
    ├── vector-store/    pgvector adapter, retrieval
    ├── approvals/       Human-in-the-loop gate management
    ├── checkpoints/     Persistent workflow snapshots
    ├── streaming/       SSE endpoints and event fan-out
    ├── queues/          BullMQ producers, consumers, workers
    └── tenants/         Tenant model, isolation, quotas
```

### 4.1 Module responsibilities

**`auth/`**
Handles registration, login, refresh tokens, password hashing, JWT signing and verification, and the `AuthGuard`. Owns nothing else.

**`users/`**
User accounts: profile fields, tenant membership. Exposes helpers that read the authenticated user from `req.user` (set by the auth middleware).

**`chats/`**
Chat entities and lifecycle: create, rename, soft-delete, list, reopen. A chat is a container. It does not run anything.

**`messages/`**
Persists user and assistant messages. Handles pagination and ordering. Assistant messages are written by workers, not by HTTP handlers directly.

**`executions/`**
The heart of the system. Owns the `Execution` entity, its status machine, its events log, and its lifecycle transitions. Exposes read-only endpoints for status and history, plus a cancel endpoint.

**`agents/`**
Declares the agent(s) available in the platform. Each agent is a bundle of: system prompt, LLM configuration, allowed tools, and a workflow reference. Multiple agents can coexist.

**`tools/`**
The tool registry. A tool has a name, a JSON schema for inputs, a JSON schema for outputs, and an executor function. Tools are safe, idempotent where possible, and observable.

**`workflows/`**
Defines LangGraph workflow graphs. Each graph is a directed graph of nodes (plan, retrieve, call tool, generate, etc.) with conditional edges and interrupts. Workflows are versioned.

**`memory/`**
Three subsystems: short-term (last N messages), long-term (retrieved facts and preferences), agent (execution-scoped state and history).

**`documents/`**
File uploads, chunking, metadata. Triggers embedding jobs on upload. Owns the document lifecycle, not the vectors themselves.

**`vector-store/`**
Thin adapter over `pgvector`. Insert, delete, similarity search. Tenant-scoped by default.

**`approvals/`**
Manages pending approvals for destructive or sensitive tool calls. Creates approval records, waits for user decision, resumes the workflow.

**`checkpoints/`**
Persists LangGraph state after each significant node. Provides restore-from-checkpoint operations for crash recovery.

**`streaming/`**
Owns SSE endpoints. Handles replay-then-subscribe, connection lifecycle, heartbeats, and back-pressure.

**`queues/`**
BullMQ producers, consumer workers, retry policies, dead-letter handling. The bridge between HTTP and workers.

**`tenants/`**
Tenant records, membership, and isolation helpers. Every repository call is tenant-scoped through this module.

**`common/`**
Cross-cutting concerns: error classes, validation middleware (Zod), error-handling middleware, request-logging middleware, correlation-id middleware, pagination helpers, common types.

---

## 5. Layered structure inside a module

Each feature module follows the same internal structure:

```
<module>/
├── <module>.routes.ts       Express Router: paths, middleware, handler bindings
├── <module>.controller.ts   Thin request/response handlers (parse, call service, respond)
├── <module>.service.ts      Business logic (pure, testable)
├── <module>.repository.ts   Prisma access, tenant-scoped
├── <module>.schemas.ts      Zod schemas for request DTOs
├── <module>.types.ts        Domain and DTO TypeScript types
└── <module>.events.ts       Domain events (optional)
```

Routers are thin: they wire middleware (auth, validation, ownership) to controller functions. Controllers are thin: they extract typed inputs, call a service, and shape the response. Services own business rules. Repositories own persistence. Domain types are not the same as Prisma models; they exist to keep the business layer decoupled.

---

## 6. Execution state machine

```
CREATED ──► QUEUED ──► RUNNING ──► THINKING ──► RUNNING ──► COMPLETED
                            │           │
                            │           ├──► WAITING_FOR_USER ──► RUNNING
                            │           ├──► WAITING_FOR_APPROVAL ──► RUNNING
                            │           └──► CANCELLED
                            └──► FAILED
```

Transition rules:

- Only the worker may transition to `RUNNING`, `THINKING`, `WAITING_*`, `COMPLETED`, `FAILED`.
- HTTP handlers may only transition to `CANCELLED` (through a cancellation signal).
- Every transition is logged as an event.
- Every transition is persisted before being streamed.

---

## 7. Data-flow rules

1. **Write to DB first, then publish.** Never publish an event that is not persisted.
2. **Read from DB on subscribe.** SSE replays persisted events before live pub/sub.
3. **Idempotent workers.** A job may be retried; the worker checks execution status before acting.
4. **Tenant scope everywhere.** Every query includes `tenantId`.

---

## 8. Failure model

- **Worker crash mid-execution:** BullMQ retries the job. The worker restores from the last checkpoint (see `checkpointing.md`).
- **API server crash:** No impact on running executions. Workers continue independently.
- **Redis outage:** New executions cannot be enqueued. Running executions continue until they need to persist a checkpoint or read cancel signals; then they pause safely.
- **Database outage:** Everything halts. This is by design; the DB is the source of truth.
- **LLM outage:** The workflow node retries with backoff, then marks execution `FAILED` with an error event.

---

## 9. Observability

- **Structured logs** with correlation IDs (`executionId`, `chatId`, `tenantId`).
- **Metrics** for queue depth, execution duration, tool latency, LLM token usage.
- **Traces** across HTTP → queue → worker → LLM.
- **Health endpoints** for API, worker, DB, Redis.

Details in `phase-14-production.md`.

---

## 10. Diagram: end-to-end message flow

```
User types message
      │
      ▼
POST /chats/:id/messages ──► Message row + Execution(CREATED) + Job(QUEUED)
      │
      ▼
Client opens SSE stream ──► replay events ──► subscribe to pub/sub
      │
      │                                      Worker
      │                                        │
      │                                        ▼
      │                          Load checkpoint / start graph
      │                                        │
      │      ┌──── event(PLANNING) ────────────┤
      │      ├──── event(RETRIEVING_DOCUMENTS)─┤
      │      ├──── event(CALLING_TOOL) ────────┤
      │      ├──── event(EXECUTING_TOOL) ──────┤
      │      ├──── event(GENERATING_RESPONSE) ─┤
      │      └──── event(COMPLETED) ───────────┘
      ▼
Client updates UI in real time; state also persisted for refresh recovery
```
