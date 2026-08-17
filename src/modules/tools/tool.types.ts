import type { z, ZodTypeAny } from 'zod';

// ─── Tool context ─────────────────────────────────────────────────────────────
//
// Passed to every tool executor so it can scope database queries and emit
// events without being given a raw tenant ID to store itself.

export interface ToolContext {
  tenantId: string;
  userId: string;
  executionId: string;
}

// ─── Tool result ──────────────────────────────────────────────────────────────

export interface ToolResult {
  /** Structured output the LLM can read. */
  output: Record<string, unknown>;
  /** Optional human-readable summary for debugging. */
  summary?: string;
}

// ─── Tool definition ──────────────────────────────────────────────────────────
//
// Every tool must implement this contract.  The registry validates
// `inputSchema` at registration time so broken schemas are caught at startup.

export interface ToolDefinition<TInput extends ZodTypeAny = ZodTypeAny> {
  /** Unique machine-readable identifier, e.g. "document_search". */
  name: string;
  /** Short prose description sent to the LLM in the tool manifest. */
  description: string;
  /** Zod schema that validates and coerces the raw LLM tool-call input. */
  inputSchema: TInput;
  /**
   * Whether this tool must be approved by a human before running.
   * Phase 11 fully wires approval flow; Phase 07 records the flag only.
   */
  requiresApproval?: boolean;
  /** Timeout in milliseconds before the execution is cancelled (default: 30 s). */
  timeoutMs?: number;
  /**
   * The actual implementation.  Receives the validated + typed input and the
   * execution context.  Must resolve or reject — never block indefinitely.
   */
  execute(input: z.infer<TInput>, ctx: ToolContext): Promise<ToolResult>;
}

// ─── LLM tool manifest ────────────────────────────────────────────────────────
//
// JSON-serialisable shape sent to the LLM API.  We derive it from the
// ToolDefinition so there is a single source of truth.

export interface ToolManifest {
  name: string;
  description: string;
  /** JSON Schema for the input parameters (derived from the Zod schema). */
  parameters: Record<string, unknown>;
  requiresApproval: boolean;
}
