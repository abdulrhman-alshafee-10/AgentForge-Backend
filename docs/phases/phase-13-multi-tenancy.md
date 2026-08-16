# Phase 13 — Multi-Tenancy

## Overview

Harden AgentForge as a true multi-tenant system. Every resource is already tenant-scoped in the schema; this phase enforces the isolation guarantees end-to-end, adds quotas, and prepares the platform for multiple tenants sharing the same deployment.

## Learning objectives

- Enforce tenant isolation at every layer: application, repository, and (optionally) database.
- Implement per-tenant quotas and rate limits.
- Design tenant onboarding and lifecycle operations.
- Audit and prove isolation with tests.

## Concepts to study

- Shared-schema multi-tenancy vs schema-per-tenant vs DB-per-tenant.
- PostgreSQL Row-Level Security (RLS).
- Redis key namespacing.
- Data residency and per-tenant configuration.

## Features to implement

- `TenantsModule`:
  - `GET /tenants/me`, `PATCH /tenants/me`.
  - Admin endpoints for creating and disabling tenants.
- Tenant context propagation:
  - Every request has `tenantId` derived from the JWT.
  - Every repository requires `tenantId`; a lint or runtime check fails builds without it.
- Redis namespacing:
  - Keys: `tenant:<id>:...`.
  - Queue names: shared for now, with `tenantId` in job payload; optional per-tenant partition later.
- Quotas per tenant (stored in `Tenant.settings`):
  - Max concurrent executions.
  - Max documents.
  - Max monthly LLM tokens.
  - Enforced by Express middleware on the API side and by explicit checks in workers.
- Optional: enable RLS on tenant-owned tables.
  - Set a session variable `app.tenant_id` at connection acquisition.
  - Add policies `USING (tenant_id = current_setting('app.tenant_id')::uuid)`.
- Cross-tenant isolation tests:
  - Attempts by tenant A to read tenant B's resources return 404 in every scenario.

## Architecture changes

- Introduce a `TenantContext` middleware that sets Redis key prefixes and (optionally) a PostgreSQL session variable `SET LOCAL app.tenant_id = ...` per request or job.
- Workers derive `tenantId` from the job payload and apply the same context.
- Add a `QuotaService` consulted by:
  - `POST /chats/:id/messages` (concurrent executions).
  - `POST /documents` (document count, storage bytes).
  - The LLM adapter (tokens/month).

## Database changes

- Optionally enable RLS on `Chat`, `Message`, `Execution`, `Event`, `Checkpoint`, `ToolCall`, `Approval`, `Memory`, `Document`, `Embedding`.
- Add a `TenantUsage` table for aggregated counters (monthly tokens, storage bytes).

## Required API endpoints

- `GET /tenants/me`, `PATCH /tenants/me`.
- Admin: `POST /admin/tenants`, `POST /admin/tenants/:id/disable`.

## Acceptance criteria

- No API call, worker job, or admin script can return cross-tenant data.
- Exceeding a quota returns `429 RATE_LIMITED` (for burst) or `403 FORBIDDEN` with a `QUOTA_EXCEEDED` code (for hard limits).
- Disabling a tenant halts new executions and denies new logins.
- If RLS is enabled, forgetting to set `app.tenant_id` results in zero rows (not full-table reads).
- Automated tests prove isolation for all major endpoints.

## Suggested reading

- PostgreSQL docs: Row Security Policies.
- "Designing multi-tenant SaaS on Postgres" articles.
- Stripe/Segment engineering blogs on tenant isolation.

## Suggested exercises

1. Enable RLS on `Message` and prove that a query without the session variable returns 0 rows.
2. Add per-tenant custom system prompts loaded at agent runtime.
3. Add a `x-tenant-usage` header returning current quota consumption for the caller.
4. Add a tenant-scoped feature flag system (e.g., `experimental.parallelRetrieval`).
5. Write a chaos test: 10 tenants, concurrent traffic, assert no cross-tenant contamination in the event log.
