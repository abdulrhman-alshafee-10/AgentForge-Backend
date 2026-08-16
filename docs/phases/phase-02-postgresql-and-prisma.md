# Phase 02 — PostgreSQL and Prisma

## Overview

Add PostgreSQL (with `pgvector`) and Prisma. Model the core entities defined in `docs/database.md`, wire the Prisma client into the Express app, and establish a repository pattern that keeps business logic decoupled from persistence.

## Learning objectives

- Design a schema that supports multi-tenancy and append-only event logs.
- Understand Prisma migrations, transactions, and relations.
- Learn `pgvector`: creation, indexes, and similarity operators.
- Set up a shared Prisma client and a repository layer used by services.

## Concepts to study

- Prisma schema syntax: models, enums, indexes, relations.
- Migration workflow: `migrate dev`, `migrate deploy`, `migrate resolve`.
- Transactions in Prisma (`$transaction`, interactive transactions).
- Connection pooling in Node.js (PgBouncer or Prisma's built-in).
- `pgvector` extension: `VECTOR(n)`, `<->`, `<=>`, `<#>` operators.
- Index types for vectors: `ivfflat`, `hnsw`.
- Row-Level Security concepts (even if you defer enabling them).

## Features to implement

- A shared Prisma client (`src/db/prisma.ts`) exported as a singleton and closed on graceful shutdown.
- Initial Prisma schema covering: `Tenant`, `User`, `Chat`, `Message`, `Execution`, `Event`, `Checkpoint`, `Memory`, `Document`, `Embedding`, `Agent`, `ToolCall`, `Approval`.
- Enums: `ExecutionStatus`, `ToolCallStatus`, `ApprovalStatus`, `MessageRole`, `DocumentStatus`.
- Enable the `pgvector` extension in a migration.
- Add all indexes from `docs/database.md`.
- Repository classes for the entities you will use first: `TenantRepository`, `UserRepository`.
- Seed script that creates a demo tenant, a demo user, and a demo agent.

## Architecture changes

- Add `src/db/prisma.ts` — a singleton Prisma client with logging hooks and shutdown handling.
- Introduce a `BaseRepository` pattern (or plain factory functions) that all repositories use to enforce tenant scoping. The tenant ID is always passed in explicitly; no ambient globals.
- Add a `TenantContext` type that later phases fill in from the JWT (via `AsyncLocalStorage` or explicit parameters).

## Database changes

- Create the full schema from `docs/database.md`.
- Enable `CREATE EXTENSION IF NOT EXISTS vector`.
- Create indexes; leave vector indexes as `ivfflat` for now.
- Add default `updatedAt` triggers or rely on Prisma `@updatedAt`.

## Required API endpoints

None in this phase. The `/health/ready` endpoint now pings the DB.

## Acceptance criteria

- `prisma migrate dev` runs cleanly on a fresh database.
- `SELECT * FROM pg_extension WHERE extname='vector'` returns a row.
- `/api/v1/health/ready` returns 200 when the DB is up, 503 when down.
- The seed script produces a repeatable, deterministic dataset.
- Attempting a query without `tenantId` throws in development.

## Suggested reading

- Prisma documentation: Schema, Migrations, Transactions.
- PostgreSQL docs: indexes, `pgvector` README.
- "Database schemas for multi-tenant applications" articles.

## Suggested exercises

1. Add a Prisma middleware that logs slow queries (>50ms) with the query and parameters.
2. Write a unit test that inserts and retrieves an embedding using `pgvector` similarity search.
3. Add a check-constraint on `Execution.status` matching the enum.
4. Model an `AuditLog` table and add it to the schema.
5. Compare `ivfflat` and `hnsw` on a small dataset and note the trade-offs.
