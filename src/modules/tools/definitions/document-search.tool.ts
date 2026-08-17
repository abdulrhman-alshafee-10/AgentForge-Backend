import { z } from 'zod';
import { ragService } from '../../rag/rag.service.js';
import type { ToolDefinition, ToolContext, ToolResult } from '../tool.types.js';

// ─── Input schema ─────────────────────────────────────────────────────────────

const InputSchema = z.object({
  query: z.string().min(1).describe('The search query to embed and retrieve chunks for'),
  k: z.number().int().min(1).max(20).default(4).describe('Number of chunks to return'),
  documentId: z.string().uuid().optional().describe('Restrict search to a specific document'),
});

// ─── Tool definition ──────────────────────────────────────────────────────────

export const documentSearchTool: ToolDefinition<typeof InputSchema> = {
  name: 'document_search',
  description:
    'Searches the tenant\'s indexed documents using semantic similarity. ' +
    'Returns the most relevant text chunks for the given query. ' +
    'Use this to answer questions grounded in uploaded documents.',
  inputSchema: InputSchema,
  requiresApproval: false,
  timeoutMs: 15_000,

  async execute(input, ctx: ToolContext): Promise<ToolResult> {
    const results = await ragService.retrieveContext({
      tenantId: ctx.tenantId,
      query: input.query,
      k: input.k,
      ...(input.documentId !== undefined && { documentId: input.documentId }),
    });

    return {
      output: {
        chunks: results.map((r) => ({
          id: r.id,
          documentId: r.documentId,
          content: r.content,
          metadata: r.metadata,
          distance: r.distance,
        })),
        total: results.length,
      },
      summary: `Found ${results.length} relevant chunk(s) for query: "${input.query}"`,
    };
  },
};
