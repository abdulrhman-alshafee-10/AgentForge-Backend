import { z } from 'zod';
import { memoryService } from '../../memory/memory.service.js';
import type { ToolDefinition, ToolContext, ToolResult } from '../tool.types.js';

// ─── Input schema ─────────────────────────────────────────────────────────────

const InputSchema = z.object({
  query: z.string().min(1).describe('The search query'),
  k: z.number().int().min(1).max(20).default(4).describe('Number of memories to return'),
  kind: z
    .enum(['preference', 'fact', 'summary', 'note'])
    .optional()
    .describe('Filter memories by kind'),
});

// ─── Tool definition ──────────────────────────────────────────────────────────

export const memorySearchTool: ToolDefinition<typeof InputSchema> = {
  name: 'memory_search',
  description:
    'Searches stored long-term memories using semantic similarity. ' +
    'Returns the most relevant memories for the current user. ' +
    'Use this to recall past preferences, facts, or conversation summaries.',
  inputSchema: InputSchema,
  requiresApproval: false,
  timeoutMs: 10_000,

  async execute(input, ctx: ToolContext): Promise<ToolResult> {
    const results = await memoryService.search({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      query: input.query,
      k: input.k,
      ...(input.kind !== undefined ? { kind: input.kind } : {}),
    });

    return {
      output: {
        memories: results.map((m) => ({
          id: m.id,
          kind: m.kind,
          key: m.key,
          content: m.content,
          metadata: m.metadata,
          distance: m.distance,
        })),
        total: results.length,
      },
      summary: `Found ${results.length} memory/memories matching "${input.query}"`,
    };
  },
};
