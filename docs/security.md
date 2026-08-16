# Security

Security in AgentForge spans authentication, authorization, tenant isolation, secret handling, LLM-specific risks, and infrastructure hardening.

---

## 1. Authentication

- **JWT** access tokens (short-lived, 15 minutes).
- **Refresh tokens** (long-lived, 30 days, rotated on use).
- Passwords hashed with **argon2id** (or bcrypt with cost ≥ 12).
- Login endpoint is rate-limited and includes lockout on repeated failures.
- Refresh tokens are stored server-side (in DB or Redis) to allow revocation.

## 2. Authorization

Two axes:

- **Role-based** (`owner`, `member`, later `admin`).
- **Tenant-based** — every request is scoped to the token's tenant.

Implemented as Express middleware, applied at the router level:

- `authenticate` — verifies the JWT and attaches `req.user` and `req.tenantId`.
- `requireTenant` — asserts `req.tenantId` is set; used on tenant-scoped routes.
- `requireRoles([...])` — checks `req.user.role` against an allow-list.
- `requireOwnership(resourceLoader)` — loads a resource within the tenant and asserts the current user owns it (used for chats, executions, documents).

## 3. Tenant isolation

- Every table has `tenantId`.
- Every repository method requires `tenantId` and refuses to run without it.
- Optional PostgreSQL **Row-Level Security** policies for defense in depth.
- Redis keys are prefixed with `tenant:<id>:...` and BullMQ queue names include tenant partitioning where scale demands.

## 4. Input validation

- Every request body, query, and params is validated by a **Zod** schema through a `validate` middleware.
- Reject unknown fields (`z.object(...).strict()`).
- Reject payloads over a hard size limit (`express.json({ limit })`).
- File uploads (via `multer`) are checked by magic bytes, not just extension or the client-reported MIME type.

## 5. Output encoding

- All API responses are JSON. No HTML rendering server-side.
- If any admin or debug page is added later, it must use context-aware escaping.

## 6. LLM-specific risks

### 6.1 Prompt injection

Untrusted text (documents, tool outputs, memory content) can contain instructions like "ignore previous instructions." AgentForge mitigates this by:

- Treating all retrieved content as **data**, not instructions.
- Wrapping retrieved content in clearly labeled delimiters and telling the system prompt to ignore instructions inside them.
- Never letting retrieved content directly control tool arguments; the LLM proposes, the tool schema validates.

### 6.2 Tool abuse

- Tools declare which arguments are safe and which need approval.
- Destructive tools (delete, send email, external write) always require approval.
- Tool inputs are validated against JSON schema before execution.

### 6.3 Data exfiltration

- Tools that make outbound network calls are allow-listed by domain.
- Tools that read files only see the current tenant's files.

### 6.4 Cost and abuse

- Per-tenant and per-user token/tool budgets.
- Per-execution hard limits (max tool calls, max nodes, max wall-clock).
- Circuit breakers on repeated failures.

## 7. Secrets management

- All secrets (LLM API keys, DB credentials, Redis credentials, JWT signing keys) come from environment variables loaded through a validated config module.
- Secrets are never logged, never returned in API responses, and never included in workflow state.
- Rotation is supported by loading new values on process restart.

## 8. Transport security

- HTTPS terminated at the ingress (Nginx / cloud LB).
- Internal traffic to Postgres and Redis over TLS in production.
- HSTS enabled at the ingress.

## 9. Storage security

- Object storage for uploaded documents uses per-tenant prefixes and pre-signed URLs with short TTLs.
- Backups are encrypted at rest.

## 10. Rate limiting

- Global per-IP limits at ingress.
- Per-user limits at the API layer via Redis-backed token bucket.
- Sensitive endpoints (login, register, cancel) have stricter budgets.

## 11. Audit logging

- Every mutation on `Execution`, `Approval`, `Memory`, and `Document` is logged with actor, before/after IDs, and timestamps.
- Audit logs are append-only and retained per compliance policy.

## 12. Dependency hygiene

- Pin dependencies with exact versions.
- Automated vulnerability scanning in CI.
- Prefer well-maintained packages; avoid packages with typosquatting-adjacent names.

## 13. Threat model summary

| Threat | Mitigation |
|---|---|
| Token theft | Short-lived access tokens, refresh rotation, revocation |
| Cross-tenant read | Tenant scoping in every query, optional RLS |
| Prompt injection | Data/instruction separation, output validation |
| Tool misuse | Schemas, approvals, allow-lists |
| DoS via LLM cost | Budgets, quotas, circuit breakers |
| SSRF via tool | Domain allow-list, no arbitrary URLs |
| Sensitive log leaks | Redaction, structured logging with allow-listed fields |
| Backup exposure | Encryption at rest, restricted access |
