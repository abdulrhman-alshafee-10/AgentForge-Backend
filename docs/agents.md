# Agents

An **agent** in AgentForge is a named configuration that binds together:

- A **system prompt** and behavior guidelines
- An **LLM** and its parameters
- A set of **allowed tools**
- A **workflow graph** (LangGraph) that shapes the reasoning loop
- Optional **memory scopes** it can read from and write to

Agents are declarative. The runtime that executes them is the worker.

---

## 1. What an agent is (and is not)

An agent **is**:

- A specification: prompt + tools + workflow + memory rules.
- Versioned: each change bumps `workflowVersion`.
- Tenant-scoped or global (built-in agents).

An agent **is not**:

- A long-lived process. The **Execution** is the runtime instance.
- A conversation. The **Chat** is the conversation container.

---

## 2. Agent anatomy

```
Agent
├── identity: name, description
├── llm: model, temperature, max tokens
├── systemPrompt: role, goals, constraints
├── tools: [documentSearch, memorySearch, webSearch, ...]
├── workflow: LangGraph graph reference + version
├── memory:
│    ├── shortTerm: last N messages window
│    ├── longTerm: retrieval strategy and write-back rules
│    └── agent: execution-scoped scratchpad
└── policies:
     ├── requires-approval: which tools need human approval
     └── rate limits: tokens/hour, tool calls/execution
```

---

## 3. The reasoning loop

Every agent execution follows a general loop shaped by its workflow graph:

```
1. Plan            — read input, gather short-term memory, decide next step
2. Retrieve        — query RAG / long-term memory / vector store if needed
3. Reason          — LLM call to think about the next action
4. Act             — call a tool or generate a response
5. Observe         — record the tool result
6. Decide          — continue looping or stop
7. Respond         — produce the final assistant message
```

LangGraph makes each step a **node**. Edges decide the flow.

---

## 4. Multi-agent thinking

Even with a single agent per chat, the graph can include **sub-agents** or **specialist nodes**:

- A **planner** node that only plans and hands off to an executor.
- A **retriever** node dedicated to search.
- A **critic** node that reviews outputs before responding.

These are internal to a workflow. From the outside, one execution is still one run.

---

## 5. Agent definition (conceptual shape)

```
{
  id, tenantId (nullable for built-ins),
  name, description,
  llm: { provider, model, temperature, maxTokens },
  systemPrompt,
  tools: ["document_search", "memory_search", "web_search", "summarize", "generate_report"],
  workflow: { graphId: "research-v3", version: "3.2.1" },
  memory: {
    shortTerm: { windowMessages: 30 },
    longTerm: { retrieveTopK: 5, writeBack: true },
    agent: { enabled: true }
  },
  policies: {
    requireApproval: ["delete_document", "send_email"],
    maxToolCallsPerExecution: 20
  }
}
```

---

## 6. Choosing an agent for a chat

A chat is bound to an `agentId` at creation. Changing an agent mid-chat is allowed but starts a new execution against the new agent; prior executions remain intact.

---

## 7. Registering tools with an agent

Only tools listed in `agent.tools` are exposed to the LLM's function-calling interface. The tool registry validates every call against its JSON schema before executing it. See `phase-07-tool-calling.md`.

---

## 8. Memory access rules

- **Short-term memory** is always available (recent messages).
- **Long-term memory** retrieval is controlled by the workflow node (e.g. `SEARCHING_MEMORY`).
- **Agent memory** is the execution's own scratchpad and is checkpointed.

Cross-user memory is never accessible. Cross-tenant memory is never accessible.

---

## 9. Failure and retry

- Every LLM call has a bounded retry policy with exponential backoff.
- Tool errors are surfaced to the LLM as observations; the LLM may retry with different inputs or give up.
- After N consecutive failures, the execution transitions to `FAILED` with an error event.

---

## 10. Determinism and reproducibility

- Executions store: `workflowVersion`, model name, temperature, tool inputs and outputs, retrieved chunk IDs, and every event.
- With those, an execution can be **replayed** for debugging, though re-running against an LLM will not produce byte-identical output.

---

## 11. Testing an agent

- **Unit** tests for each tool.
- **Node** tests: each LangGraph node in isolation with mocked LLM.
- **Integration** tests: full workflow with a deterministic fake LLM.
- **Golden** conversations: fixed input, snapshot of event sequence.

Details in the phase docs.
