# AgentForge — Backend

AgentForge is a learning-focused, production-shaped **Agentic AI platform** built with Node.js, TypeScript, and **Express**. The purpose of this repository is to teach **Agentic AI engineering**: how to design, run, persist, stream, and recover long-running autonomous agents that use tools, memory, and knowledge bases.

This is not an e-commerce backend, not a CRM, not a support bot. The **AI agent is the center of the system**. Everything in the codebase exists to make agent execution reliable, observable, resumable, and safe.

> This directory contains **documentation only**. No application code is generated here. The docs describe the architecture, the modules, the database, the APIs, and a 14-phase learning roadmap.

---

## What you will learn

By following the phases in `docs/phases/`, you will learn:

- **Express architecture** — feature-first modules, routers, middleware chains, error handling, composition roots
- **TypeScript** — strict typing, discriminated unions for agent events, request/response types
- **PostgreSQL** — schema design for agent state, events, and executions
- **Prisma** — modelling, migrations, transactions, relations
- **Authentication & authorization** — JWT, refresh tokens, RBAC, tenant scoping
- **Chat persistence** — permanent conversations, resumable UIs
- **Server-Sent Events (SSE)** — native `text/event-stream` responses with replay + subscribe
- **LangGraph** — graph-based agent workflows with interrupts and checkpoints
- **LangChain** — LLM abstractions, tools, retrievers, prompt templates
- **RAG (Retrieval Augmented Generation)** — chunking, embeddings, retrieval, context injection
- **Vector databases** — `pgvector` inside PostgreSQL
- **Agent workflows** — planning, routing, parallel branches, conditional edges
- **Tool calling** — registered tools, safe execution, structured results
- **Memory systems** — short-term, long-term, and agent (execution) memory
- **Checkpointing** — persistent workflow state, crash recovery
- **Human-in-the-loop** — approvals, interrupts, resume semantics
- **Background execution** — Redis + BullMQ workers decoupled from HTTP
- **Multi-tenancy** — strict per-tenant isolation across all resources
- **Production architecture** — logging, tracing, metrics, rate limiting, caching, deployment

---

## Technology stack

| Layer | Choice |
|---|---|
| Runtime | Node.js |
| Language | TypeScript |
| HTTP framework | Express |
| Validation | Zod |
| Logging | Pino |
| AI orchestration | LangGraph, LangChain |
| Database | PostgreSQL with `pgvector` |
| ORM | Prisma |
| Queue | Redis + BullMQ |
| Streaming | Server-Sent Events (SSE) |
| Authentication | JWT (access + refresh) |
| Password hashing | argon2id |

Supporting libraries you will meet along the way: `helmet`, `cors`, `express-rate-limit`, `multer`, `pino-http`, `ioredis`, `jsonwebtoken`, `argon2`, `zod`, `awilix` (optional DI container), `supertest`.

---

## Core architectural rules

These rules are non-negotiable and drive every design decision in the docs.

1. **The backend is the single source of truth.** The frontend only renders state; it never owns state.
2. **The agent runs independently of the browser.** Closing a tab, refreshing the page, or dropping the SSE connection must **never** stop an execution.
3. **HTTP is separate from execution.** HTTP handlers only create, read, cancel, or subscribe. AI work happens inside workers.
4. **Chats and executions are different entities.** A chat holds messages. An execution is one agent run. A chat can have many executions.
5. **Every execution has its own state.** Its own status, events, tool calls, checkpoints, and memory context.
6. **Every event is persisted.** SSE is a delivery mechanism, not a source of truth. The database is.
7. **Every tenant is isolated.** No cross-tenant reads. No cross-tenant writes. No shared vectors.

---

## Execution-based architecture

```
User
 └── Chat
      ├── Messages
      └── Executions
           ├── Execution #1  (COMPLETED)
           ├── Execution #2  (CANCELLED)
           └── Execution #3  (RUNNING)
                ├── Events
                ├── ToolCalls
                ├── Checkpoints
                └── Memory context
```

Every execution owns:

- Workflow state (LangGraph state object, persisted)
- Status (see below)
- Events (append-only log)
- Tool calls (structured inputs and results)
- Checkpoints (recoverable snapshots)
- Memory context (short-term + retrieved long-term)

---

## Execution statuses

An execution's status is stored in PostgreSQL and streamed over SSE.

| Status | Meaning |
|---|---|
| `CREATED` | Row exists, not yet queued |
| `QUEUED` | Placed on BullMQ, waiting for a worker |
| `RUNNING` | Worker picked it up |
| `THINKING` | LLM call in progress |
| `WAITING_FOR_USER` | Needs user input to continue |
| `WAITING_FOR_APPROVAL` | Paused on a human-in-the-loop gate |
| `COMPLETED` | Finished successfully |
| `FAILED` | Terminated with an error |
| `CANCELLED` | User or system aborted it |

Statuses must be **recoverable after a restart** and **available through the API** and **streamed through SSE**.

---

## Documentation map

```
backend/
├── README.md                          ← you are here
└── docs/
    ├── architecture.md                ← modules, layers, execution model
    ├── database.md                    ← schemas, relations, indexes
    ├── api.md                         ← REST + SSE contract
    ├── agents.md                      ← LangGraph, planning, routing
    ├── streaming.md                   ← SSE event contract, recovery
    ├── checkpointing.md               ← snapshots and crash recovery
    ├── memory.md                      ← short/long/agent memory
    ├── security.md                    ← auth, tenancy, rate limits, secrets
    └── phases/
        ├── phase-01-express-foundation.md
        ├── phase-02-postgresql-and-prisma.md
        ├── phase-03-authentication.md
        ├── phase-04-chat-and-message-persistence.md
        ├── phase-05-sse-streaming.md
        ├── phase-06-rag.md
        ├── phase-07-tool-calling.md
        ├── phase-08-langgraph-workflows.md
        ├── phase-09-background-jobs.md
        ├── phase-10-checkpointing.md
        ├── phase-11-human-in-the-loop.md
        ├── phase-12-memory.md
        ├── phase-13-multi-tenancy.md
        └── phase-14-production.md
```

---

## How to use this roadmap

1. Read `docs/architecture.md` end-to-end before writing anything.
2. Read `docs/database.md`, `docs/api.md`, and `docs/streaming.md` next; they define contracts.
3. Work through `docs/phases/` in order. Each phase builds on the previous one.
4. Do the **suggested exercises** at the end of every phase. They are the actual learning surface.
5. Treat every phase's **acceptance criteria** as a gate. Do not proceed until they pass.

---

## Restrictions honored by this repository

- Markdown documentation only.
- No JavaScript, no TypeScript, no Express source code.
- No API implementation, no database migrations, no seeders.
- The focus is architecture, contracts, and the learning roadmap.
