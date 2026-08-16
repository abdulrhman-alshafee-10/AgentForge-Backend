# Phase 11 — Human-in-the-Loop

## Overview

Add **approvals** for destructive or sensitive actions. When a workflow proposes such an action, execution pauses at a checkpoint, an `Approval` row is created, and the worker releases the job. The user approves or rejects via the API; a resume job re-enters the workflow and continues.

## Learning objectives

- Use LangGraph **interrupts** to pause a workflow safely.
- Model approvals as first-class entities with state and audit trail.
- Coordinate resume across queues, workers, and checkpoints.
- Design timeouts and expirations for pending approvals.

## Concepts to study

- LangGraph interrupts and `interruptAfter` / `interruptBefore`.
- Long-lived paused workflows: freeing the worker while preserving state.
- Approval semantics: single approver, multi-approver, quorum.
- Event modelling for approvals: `WAITING_FOR_APPROVAL`, `APPROVAL_DECISION`.

## Features to implement

- `ApprovalsModule`:
  - `POST /approvals/:id/decision`, `GET /approvals`, `GET /approvals/:id` (see `docs/api.md`).
- Tools opt into approval by setting `requiresApproval: true` (or a predicate).
- Workflow node `act`:
  1. If the chosen tool requires approval, save a checkpoint.
  2. Create an `Approval` row with `reason` and `payload`.
  3. Emit `WAITING_FOR_APPROVAL` event.
  4. Transition execution to `WAITING_FOR_APPROVAL`.
  5. Return from the worker; do not hold the job.
- On decision:
  1. `POST /approvals/:id/decision` updates the row.
  2. Emit `APPROVAL_DECISION` event.
  3. Enqueue a resume job for the execution.
  4. Worker loads checkpoint; if approved, runs the tool; if rejected, records an observation and returns to `reason`.
- Expiration:
  - Approvals have an `expiresAt`. A sweeper marks stale ones `EXPIRED` and enqueues a resume with a rejection observation.

## Architecture changes

- The state machine gains transitions:
  - `RUNNING` → `WAITING_FOR_APPROVAL`
  - `WAITING_FOR_APPROVAL` → `RUNNING` (on approve or reject)
- The worker becomes stateless with respect to pauses: everything lives in the DB.
- Add an `ApprovalService` that owns the approval lifecycle.

## Database changes

- Confirm the `Approval` table from `docs/database.md`.
- Add index `(tenantId, status, createdAt)` for the pending-approvals list.

## Required API endpoints

See Section 7 of `docs/api.md`.

## Acceptance criteria

- A tool marked `requiresApproval` pauses the execution and creates an `Approval`.
- The worker is not held during the pause.
- Approving resumes the execution and runs the tool.
- Rejecting resumes the execution and records the rejection as an observation; the agent reacts (e.g., proposes an alternative).
- Expired approvals do not leave executions stuck.
- Cross-user or cross-tenant decisions are forbidden.

## Suggested reading

- LangGraph docs: human-in-the-loop, breakpoints.
- Workflow engines (Temporal, Camunda) for pause/resume patterns.

## Suggested exercises

1. Add multi-approver quorum: N-of-M owners must approve.
2. Add a "one-click" approval link (signed URL) sent via email or webhook.
3. Add a per-tool approval TTL; test expiration by fast-forwarding time in tests.
4. Add an audit endpoint listing all approvals with actor and decision.
5. Support conditional approvals: user can approve with modified arguments before the tool runs.
