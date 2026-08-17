import { z } from 'zod';
import OpenAI from 'openai';
import { env } from '../../../config/env.js';
import type { ToolDefinition, ToolContext, ToolResult } from '../tool.types.js';

// ─── Input schema ─────────────────────────────────────────────────────────────

const InputSchema = z.object({
  text: z
    .string()
    .min(1)
    .max(50_000)
    .describe('The text to summarise'),
  maxWords: z
    .number()
    .int()
    .min(10)
    .max(500)
    .default(100)
    .describe('Target length of the summary in words'),
  style: z
    .enum(['bullet', 'paragraph'])
    .default('paragraph')
    .describe('Output format: bullet list or flowing paragraph'),
});

// ─── Tool definition ──────────────────────────────────────────────────────────

export const summarizeTool: ToolDefinition<typeof InputSchema> = {
  name: 'summarize',
  description:
    'Summarises a block of text using the LLM. ' +
    'Returns a concise summary in either paragraph or bullet-point format.',
  inputSchema: InputSchema,
  requiresApproval: false,
  timeoutMs: 30_000,

  async execute(input, _ctx: ToolContext): Promise<ToolResult> {
    const client = new OpenAI({
      baseURL: env.OLLAMA_BASE_URL,
      apiKey: env.OLLAMA_API_KEY,
    });

    const styleInstruction =
      input.style === 'bullet'
        ? 'Format the summary as a concise bullet list.'
        : 'Write the summary as a single flowing paragraph.';

    const prompt =
      `Summarise the following text in approximately ${input.maxWords} words. ` +
      `${styleInstruction}\n\n---\n${input.text}`;

    const response = await client.chat.completions.create({
      model: env.OLLAMA_CHAT_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
    });

    const summary = response.choices[0]?.message?.content?.trim() ?? '';

    return {
      output: { summary, style: input.style },
      summary: `Summarised ${input.text.split(/\s+/).length} words → ${summary.split(/\s+/).length} words`,
    };
  },
};
