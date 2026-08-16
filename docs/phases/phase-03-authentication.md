# Phase 03 — Authentication

## Overview

Implement JWT-based authentication with refresh token rotation, wire the tenant context, and secure every subsequent endpoint. The result: a user can register, log in, and hit protected endpoints scoped to their tenant.

## Learning objectives

- Implement JWT access + refresh flows correctly (rotation, revocation).
- Hash passwords safely with argon2id (or bcrypt).
- Build Express middleware for authentication, tenancy, and roles.
- Derive a `TenantContext` from the JWT and make it available everywhere without prop-drilling (e.g., via `AsyncLocalStorage`).

## Concepts to study

- JWT structure, claims, signature algorithms (prefer `EdDSA` or `RS256` over `HS256`).
- Access vs refresh token lifetimes and rotation.
- Refresh token storage strategies (DB, Redis, or hybrid).
- Express middleware composition and typed `Request` augmentation (`Request & { user, tenantId }`).
- Zod schemas for auth request bodies.
- Password strength policy and lockout.
- Rate limiting login endpoints with `express-rate-limit` backed by Redis.

## Features to implement

- `modules/auth/`:
  - `POST /auth/register`
  - `POST /auth/login`
  - `POST /auth/refresh`
  - `POST /auth/logout`
  - `GET /auth/me`
- `authenticate` middleware, applied by default to all `/api/v1/*` routes except an allow-list (`/auth/register`, `/auth/login`, `/auth/refresh`, `/health/*`).
- `requireTenant` middleware, applied to tenant-scoped routers.
- `requireRoles([...])` middleware with roles `owner`, `member`.
- Refresh token model (DB table `RefreshToken` with `userId`, `tokenHash`, `expiresAt`, `revokedAt`, `familyId`).
- Rotation on refresh: revoke old, issue new; both bound to the same `familyId`.
- **Reuse detection:** if a revoked refresh token is presented, revoke the whole `familyId` and force re-login.
- Token-augmented `Request` type declared in `src/common/types/express.d.ts`.

## Architecture changes

- Add `RefreshToken` to the Prisma schema.
- Add `TokenService` (sign/verify access, sign/verify refresh) and `PasswordService` (argon2 hash/verify) as plain classes or factory functions.
- Add a `TenantContext` via `AsyncLocalStorage`: the `authenticate` middleware calls `als.run({ userId, tenantId, role }, next)`. Repositories can read the context when a caller does not pass tenantId explicitly (services should still prefer explicit params).
- Add Redis-backed rate limiters for `/auth/register` and `/auth/login`.

## Database changes

- New table `RefreshToken` with columns `id`, `userId`, `tokenHash`, `familyId`, `expiresAt`, `revokedAt`, `createdAt`, `userAgent?`, `ipHash?`.
- Indexes: `(userId, revokedAt)`, `tokenHash` unique, `familyId`.

## Required API endpoints

See Section 2 of `docs/api.md`.

## Acceptance criteria

- Register + login + refresh works end-to-end.
- Access tokens expire in 15 minutes; refresh tokens in 30 days.
- Reusing a rotated refresh token invalidates the entire family.
- Protected endpoints return 401 without a token and 404 (to hide existence) across tenants.
- Password hashing uses argon2id with sensible parameters (memoryCost, timeCost, parallelism tuned for the host).
- Login endpoint enforces per-IP and per-account rate limits (e.g., 5/min per IP, 10/hour per account).
- The auth middleware chain is applied globally with an explicit `publicRoutes` allow-list.

## Suggested reading

- OWASP: Authentication Cheat Sheet, Session Management Cheat Sheet.
- RFC 7519 (JWT), RFC 6749 (OAuth 2.0) — for terminology.
- Auth0 blog on refresh token rotation and reuse detection.
- `express-rate-limit` docs and Redis store integrations.

## Suggested exercises

1. Add an email-verification flow with a one-time token stored in Redis with TTL.
2. Add MFA (TOTP) as an optional second factor for `owner` accounts.
3. Add device tracking to refresh tokens (user-agent, IP hash) and expose a `GET /auth/sessions` endpoint plus `DELETE /auth/sessions/:id`.
4. Write an integration test with `supertest` that proves reuse detection revokes all sibling tokens.
5. Move the `TenantContext` from `AsyncLocalStorage` to an explicit parameter through one service and note the trade-offs.
