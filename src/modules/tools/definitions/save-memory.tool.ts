import { z } from 'zod';
import { memoryService } from '../../memory/memory.service.js';
import type { ToolDefinition, ToolContext, ToolResult } from '../tool.types.js';

// ─── Input schema ─────────────────────────────────────────────────────────────

const InputSchema = z.object({
  kind: z
    .enum(['preference', 'fact', 'summary', 'note'])
    .describe('The type of memory to save'),
  content: z
    .string()
    .min(1)
    .max(5_000)
    .describe('The memory content to persist'),
  key: z
    .string()
    .max(255)
    .optional()
    .describe('Optional stable key for upsert semantics (same key = update existing)'),
  metadata: z
    .record(z.unknown())
    .optional()
    .describe('Optional structured metadata to attach to the memory'),
});

// ─── Tool definition ──────────────────────────────────────────────────────────

export const saveMemoryTool: ToolDefinition<typeof InputSchema> = {
  name: 'save_memory',
  description:
    'Persists a fact, preference, or note to the user\'s long-term memory. ' +
    'Use this when the user states a preference, reveals an important fact, or explicitly asks to remember something. ' +
    'Memories are retrieved in future conversations via memory_search.',
  inputSchema: InputSchema,
  requiresApproval: false,
  timeoutMs: 15_000,

  async execute(input, ctx: ToolContext): Promise<ToolResult> {
    const memory = await memoryService.save({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      kind: input.kind,
      content: input.content,
      ...(input.key !== undefined ? { key: input.key } : {}),
      ...(input.metadata !== undefined ? { metadata: input.metadata as Record<string, unknown> } : {}),
    });

    return {
      output: {
        memoryId: memory.id,
        kind: memory.kind,
        key: memory.key,
        saved: true,
      },
      summary: `Saved ${input.kind} memory: "${input.content.slice(0, 60)}${input.content.length > 60 ? '…' : ''}"`,
    };
  },
};
