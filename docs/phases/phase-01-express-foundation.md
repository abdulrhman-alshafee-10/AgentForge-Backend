# Phase 01 — Express Foundation

## Overview

Bootstrap the AgentForge backend as an **Express** application with strict TypeScript, a feature-first folder layout, environment-validated configuration, structured logging, and health checks. This phase ships nothing user-facing. It builds the foundation every later phase depends on.

## Learning objectives

- Compose an Express 4/5 application from small, testable pieces.
- Design a **feature-first** folder layout with routers, controllers, services, and repositories.
- Set up validated, environment-driven configuration.
- Add structured logging with correlation IDs from day one.
- Establish a consistent error-handling contract via a global error middleware.

## Concepts to study

- The Express request lifecycle: middleware chain, route handlers, error middleware.
- The difference between middleware, route handlers, and error handlers (`(err, req, res, next)`).
- Async errors in Express (`express-async-errors` or a `wrap` helper).
- Zod for schema validation of `req.body`, `req.query`, `req.params`.
- `pino` + `pino-http` for structured JSON logging.
- Dependency wiring: manual composition roots vs a small DI container (e.g., `awilix`).
- Graceful shutdown patterns (SIGTERM, in-flight request draining).

## Features to implement

- A working Express application that boots and responds to `GET /api/v1/health/live`.
- **Global middleware chain (in order):**
  1. `helmet()` for baseline security headers
  2. `cors()` with allow-listed origins
  3. `express.json({ limit })` with a strict body size limit
  4. `correlationId()` — reads or generates `x-correlation-id`, attaches to `req` and response header
  5. `pino-http` with correlation ID injected into log context
  6. Routers under `/api/v1/*`
  7. 404 handler for unknown routes
  8. **Error-handling middleware** that returns the error envelope from `docs/api.md`
- A **Zod validation middleware** (`validate({ body?, query?, params? })`) used by any route needing input validation.
- A **config loader** (`src/config/env.ts`) that parses `process.env` with Zod and exits the process on failure.
- API prefix `/api/v1` and URI-based versioning ready to be extended (`/api/v2`).
- Health endpoints:
  - `GET /api/v1/health/live` — process is alive (always 200).
  - `GET /api/v1/health/ready` — dependencies reachable (always 200 in this phase).

## Architecture changes

Create the skeleton folders that later phases will fill in. Each feature is self-contained: routes + controller functions + service + (optional) repository.

```
src/
├── config/
│   └── env.ts                     Zod-validated env loader
├── common/
│   ├── errors/                    AppError, NotFoundError, ValidationError, ...
│   ├── middleware/
│   │   ├── correlation-id.ts
│   │   ├── error-handler.ts
│   │   ├── not-found.ts
│   │   └── validate.ts            Zod adapter
│   ├── logger/
│   │   └── logger.ts              pino instance
│   └── utils/
│       └── pagination.ts
├── modules/
│   ├── auth/
│   ├── users/
│   ├── chats/
│   ├── messages/
│   ├── executions/
│   ├── agents/
│   ├── tools/
│   ├── workflows/
│   ├── memory/
│   ├── documents/
│   ├── vector-store/
│   ├── approvals/
│   ├── checkpoints/
│   ├── streaming/
│   ├── queues/
│   ├── tenants/
│   └── health/
│       ├── health.routes.ts
│       └── health.controller.ts
├── app.ts                         builds the Express app (no listen)
├── server.ts                      binds app to a port, handles shutdown
└── worker.ts                      empty stub; BullMQ worker entrypoint (Phase 09)
```

Each module folder later contains:

```
<module>/
├── <module>.routes.ts     Express Router
├── <module>.controller.ts Request/response glue (thin)
├── <module>.service.ts    Business logic (pure, testable)
├── <module>.repository.ts Prisma access (added from Phase 02)
├── <module>.schemas.ts    Zod schemas for DTOs
└── <module>.types.ts      Domain and DTO TypeScript types
```

## Database changes

None yet. Database work starts in Phase 02.

## Required API endpoints

- `GET /api/v1/health/live` — process is alive.
- `GET /api/v1/health/ready` — dependencies (once added) are reachable. In this phase it always returns 200.

## Acceptance criteria

- `npm run dev` starts the server without errors.
- `GET /api/v1/health/live` returns `200 { status: "ok" }`.
- An invalid body to any placeholder endpoint returns a `VALIDATION_ERROR` envelope with HTTP 400.
- Every log line includes `correlationId`.
- Missing or invalid environment variables cause the app to exit at startup with a clear message printed to stderr.
- `tsconfig.json` has `strict: true`, `noImplicitAny: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`.
- Uncaught async errors inside route handlers reach the global error middleware.
- SIGTERM triggers graceful shutdown: stop accepting new connections, wait for in-flight requests up to a bounded timeout, then exit.

## Suggested reading

- Express documentation: routing, middleware, error handling.
- Zod documentation: schema composition, `safeParse`, error mapping.
- `pino` and `pino-http` docs.
- 12-Factor App: Config.
- TypeScript Handbook: strict mode, narrowing, discriminated unions.

## Suggested exercises

1. Add a `RequestContext` module using Node's `AsyncLocalStorage` so any service can read the current `correlationId` without prop-drilling.
2. Add a `wrap()` helper that lifts async route handlers into safe middleware; compare it with `express-async-errors`.
3. Write a small `AppError` class hierarchy and make the error middleware translate them into the `docs/api.md` envelope.
4. Add a Zod schema for the environment; intentionally break a variable to see the fail-fast behavior.
5. Add a `PaginationSchema` (`cursor`, `limit`) and use it in a placeholder endpoint to validate query params.
6. Choose between manual composition and `awilix`. Wire one placeholder service both ways and note the trade-offs.
