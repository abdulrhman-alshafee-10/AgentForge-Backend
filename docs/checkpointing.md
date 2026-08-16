# Checkpointing

Checkpointing makes AgentForge **resilient**. A checkpoint is a durable snapshot of a workflow's state at a specific point in its execution. If the worker crashes, the queue reschedules the job, and the workflow **resumes from the latest checkpoint** rather than starting over.

---

## 1. Why checkpointing

Without checkpoints:

- A crash after a 20-second tool call restarts the tool call.
- A restart after a large RAG retrieval re-embeds and re-searches.
- Human-in-the-loop pauses cannot survive server restarts.

With checkpoints:

- Every significant step is durable.
- The system is safe to restart, deploy, and scale.
- Interrupts (approvals, user input) can span hours or days.

---

## 2. What gets checkpointed

The LangGraph state object. This typically includes:

- The user input and normalized prompt
- The plan (if the workflow has a planner)
- Retrieved documents (IDs and metadata, not full text if large)
- Retrieved memories (IDs)
- Tool call history (references to `ToolCall` rows)
- The current node
- Any node-local scratch state

Not checkpointed:

- Full LLM streaming buffers (redundant; deltas are events).
- Secret material (never persisted in state).

---

## 3. Storage model

Each checkpoint is a row in the `Checkpoint` table:

```
Checkpoint
├── id
├── tenantId
├── executionId
├── nodeName          — which node produced this checkpoint
├── state             — JSONB, serialized graph state
├── parentCheckpointId — optional, for branching
└── createdAt
```

The **latest** checkpoint for an execution is defined as the row with the greatest `createdAt` for that `executionId`.

---

## 4. When to checkpoint

Create a checkpoint:

- After the planner produces a plan.
- After RAG retrieval completes.
- Before and after each tool call.
- Before entering a `WAITING_FOR_*` state.
- Before starting the final generation.

Rule of thumb: **checkpoint at every point where losing work would cost > 1 second of user-visible latency or a paid resource call.**

---

## 5. Recovery flow

```
Worker starts a job for executionId X
   │
   ▼
Load latest checkpoint for X
   │
   ├── none? → start graph from initial state
   └── found? → resume graph at checkpoint.nodeName with checkpoint.state
   │
   ▼
Continue execution
```

The worker must be **idempotent**:

- Re-emitting the same `PLANNING` event after resume is fine (events are append-only; consumers deduplicate on `sequence`).
- Tool calls should not be replayed. Check the `ToolCall` table for an existing pending or completed call for the same node input hash before executing.

---

## 6. Interrupts and long pauses

For `WAITING_FOR_USER` and `WAITING_FOR_APPROVAL`:

1. Save checkpoint.
2. Transition status.
3. Emit event.
4. **Release the worker.** Do not hold a job while waiting on humans.
5. When the user acts (message or approval), enqueue a **resume job** with the executionId.
6. A worker picks it up, loads the checkpoint, and continues.

This lets pauses last minutes, hours, or days without pinning resources.

---

## 7. Crash recovery

Sequence on worker crash:

```
Worker dies during node N
   │
   ▼
BullMQ marks job failed, retry policy applies
   │
   ▼
Retry: another worker picks up the job
   │
   ▼
Load latest checkpoint (whatever was saved before N started or a partial one)
   │
   ▼
Resume at that checkpoint
```

If node N had side effects (a tool call), the worker consults the `ToolCall` table:

- If a matching call exists with `SUCCESS`, reuse its output.
- If it exists with `PENDING` or `RUNNING`, wait or fail-forward per policy.
- If none exists, execute.

---

## 8. Checkpoint pruning

Checkpoints can grow. Strategy:

- Keep **all** checkpoints for **non-terminal** executions.
- After an execution completes, keep the **first** and **last** checkpoints plus any at `WAITING_FOR_APPROVAL` boundaries.
- Delete intermediate checkpoints via a nightly job.
- Compressed archival to object storage optional for compliance.

---

## 9. Serialization concerns

- All state must be JSON-serializable.
- Wrap non-serializable references (streams, file handles) with IDs; resolve them at resume time.
- Version the state shape (`stateVersion`) so future graph changes can migrate old checkpoints.

---

## 10. Testing recovery

Every workflow must have tests that:

- Kill the worker mid-node and verify resume.
- Verify no duplicate tool calls after resume.
- Verify event sequences remain monotonic across resume boundaries.

---

## 11. Relationship with LangGraph

LangGraph natively supports checkpointers. AgentForge implements a **Postgres checkpointer** that writes to the `Checkpoint` table and reads latest state on resume. Alternative in-memory or Redis checkpointers exist for tests but are not used in production.
