# Phase 14 — Production

## Overview

Turn AgentForge into a production-ready service. This phase covers observability, resilience, deployment, and operational readiness. The goal: run AgentForge on real infrastructure, with real users, without waking up at 3 AM.

## Learning objectives

- Add end-to-end observability: logs, metrics, traces.
- Add resilience: rate limiting, caching, circuit breakers, graceful shutdown.
- Containerize and deploy the API and workers separately.
- Scale horizontally with confidence.

## Concepts to study

- Structured logging with correlation IDs (already introduced; harden it).
- OpenTelemetry for traces and metrics.
- Prometheus + Grafana or a hosted equivalent.
- Rate limiting patterns (token bucket, sliding window).
- Caching strategies (per-request, per-tenant, per-embedding).
- Container orchestration (Kubernetes, ECS, Fly.io, Railway).
- Zero-downtime deploys and blue/green or rolling strategies.

## Features to implement

### Observability
- Structured JSON logs to stdout with fields: `timestamp`, `level`, `correlationId`, `tenantId`, `userId`, `executionId`, `message`, `context`.
- Redact sensitive fields (`password`, `token`, `secret`).
- OpenTelemetry SDK for:
  - HTTP spans (server).
  - DB spans (Prisma).
  - Redis spans.
  - LLM spans (with model, tokens, latency).
  - Tool spans.
- Metrics:
  - Queue depth (waiting, active, delayed, failed).
  - Execution duration (p50, p95, p99).
  - LLM token usage per tenant.
  - Tool latency and error rate.
  - SSE active streams.
- Health endpoints:
  - `/health/live` — process up.
  - `/health/ready` — dependencies up.
- Alerting on: high failure rate, stuck executions, queue backlog, DB CPU.

### Rate limiting
- Global per-IP at the ingress.
- Per-user token bucket in Redis for API calls.
- Per-endpoint budgets for auth, send message, upload, stream connect.
- Per-tenant LLM cost caps that fail-closed when exceeded.

### Caching
- Cache embeddings by content hash (Redis).
- Cache LLM responses for deterministic tools (opt-in per tool).
- Cache tenant settings with a short TTL.

### Error handling
- Global exception filter with the error envelope from `docs/api.md`.
- Distinguish user errors (4xx) from system errors (5xx) in logs and metrics.
- Retry with exponential backoff for transient dependencies (LLM, Redis).
- Circuit breakers on LLM providers with automatic failover to a secondary provider (optional).

### Security hardening
- CSP and security headers at ingress.
- Secrets from a secret manager (AWS Secrets Manager, Vault, cloud provider equivalents).
- Rotate JWT signing keys with a JWKS-style rollover.
- Automated dependency scans in CI.

### Containerization
- Two images: `api` and `worker`, both from the same source tree, different entrypoints.
- Multi-stage Dockerfiles: `deps` → `build` → `runtime`.
- Non-root user, minimal base image (`node:*-alpine` or distroless).
- Health check commands in the image.

### Deployment
- Migration step in the deploy pipeline runs before the new API image starts.
- Rolling deploys for API. Workers drain gracefully (finish current node, stop accepting new jobs).
- Feature flags for risky changes.

### Horizontal scaling
- API is stateless; scale by CPU or RPS.
- Workers scale by queue depth.
- Postgres: primary + read replicas for read-heavy endpoints (chat lists, event replay).
- Redis: managed with persistence enabled.

## Architecture changes

- Add `common/observability/` for tracer and metrics setup.
- Add `common/cache/` for the caching abstraction.
- Add graceful shutdown hooks in `main.ts` and `worker.ts`.
- Add readiness gating for workers (only mark ready after DB, Redis, and LLM ping succeed).

## Database changes

- Add read replicas (infra concern).
- Add partial indexes for hot queries if profiling shows a need.
- Add regular `VACUUM ANALYZE` and index maintenance jobs.

## Required API endpoints

- `/health/live`, `/health/ready`, `/metrics` (Prometheus format), `/admin/queues`.

## Acceptance criteria

- p95 latency for `GET /chats` under 100 ms at design load.
- p95 for `POST /messages` under 200 ms (excluding agent work).
- Zero data loss on rolling deploys (verified by a chaos test).
- Zero cross-tenant leaks under load (verified by a chaos test).
- Rate limits enforce as designed and return the correct error envelope.
- Observability dashboards show real-time execution health.

## Suggested reading

- Google SRE Book (chapters on monitoring, incident response).
- OpenTelemetry docs.
- Node.js + Express deployment guides for PM2, Docker, and Kubernetes.
- BullMQ production checklist.

## Suggested exercises

1. Write a chaos test that kills random workers every 10 seconds for an hour and asserts no execution is lost.
2. Add distributed tracing across HTTP → queue → worker → LLM and view a full waterfall in your tracing tool.
3. Add a per-tenant cost dashboard driven by token metrics.
4. Enable Postgres read replicas and route event replay queries to a replica.
5. Run a load test at 10x design capacity and document where the first bottleneck appears; fix it.
