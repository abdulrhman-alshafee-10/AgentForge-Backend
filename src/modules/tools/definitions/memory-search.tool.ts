import { z } from 'zod';
import { prisma } from '../../../db/prisma.js';
import type { ToolDefinition, ToolContext, ToolResult } from '../tool.types.js';

// ─── Input schema ─────────────────────────────────────────────────────────────

const InputSchema = z.object({
  query: z.string().min(1).describe('The search query'),
  k: z.number().int().min(1).max(20).default(4).describe('Number of memories to return'),
  scope: z
    .enum(['user', 'chat', 'global'])
    .default('user')
    .describe('Scope: user = user-level memories, chat = this chat, global = all tenant memories'),
  kind: z.string().optional().describe('Filter memories by kind (e.g. "preference", "fact")'),
});

// ─── Tool definition ──────────────────────────────────────────────────────────
//
// Phase 12 will add vector-based memory search.  For now we do a simple
// text ILIKE search scoped to the appropriate Memory rows.

export const memorySearchTool: ToolDefinition<typeof InputSchema> = {
  name: 'memory_search',
  description:
    'Searches stored memories for the current user or chat. ' +
    'Returns memories whose content matches the query. ' +
    'Use this to recall past preferences, facts, or conversation summaries.',
  inputSchema: InputSchema,
  requiresApproval: false,
  timeoutMs: 10_000,

  async execute(input, ctx: ToolContext): Promise<ToolResult> {
    const { tenantId, userId } = ctx;

    // Build a scoped where clause for a simple text search.
    // Phase 12 will replace this with vector similarity search via pgvector.
    const where: Record<string, unknown> = {
      tenantId,
      content: { contains: input.query, mode: 'insensitive' },
    };

    if (input.kind) {
      where.kind = input.kind;
    }

    if (input.scope === 'user') {
      where.userId = userId;
    }
    // 'chat' scope would need the chatId from ctx — added in Phase 12
    // 'global' scope keeps only tenantId

    const memories = await (prisma.memory.findMany as any)({
      where,
      take: input.k,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        kind: true,
        key: true,
        content: true,
        metadata: true,
        createdAt: true,
      },
    });

    return {
      output: {
        memories,
        total: memories.length,
      },
      summary: `Found ${memories.length} memory/memories matching "${input.query}"`,
    };
  },
};
