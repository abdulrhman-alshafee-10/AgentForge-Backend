import { z } from 'zod';
import OpenAI from 'openai';
import { env } from '../../../config/env.js';
import type { ToolDefinition, ToolContext, ToolResult } from '../tool.types.js';

// ─── Input schema ─────────────────────────────────────────────────────────────

const SectionSchema = z.object({
  heading: z.string().min(1).describe('Section heading'),
  content: z.string().min(1).describe('Section body text or notes to expand'),
});

const InputSchema = z.object({
  title: z.string().min(1).describe('Report title'),
  sections: z
    .array(SectionSchema)
    .min(1)
    .max(10)
    .describe('Ordered list of sections to include in the report'),
  tone: z
    .enum(['formal', 'casual', 'technical'])
    .default('formal')
    .describe('Writing tone for the report'),
});

// ─── Tool definition ──────────────────────────────────────────────────────────
//
// This tool requires approval because it produces a substantial deliverable
// that a human should review before it is sent or saved.

export const generateReportTool: ToolDefinition<typeof InputSchema> = {
  name: 'generate_report',
  description:
    'Assembles a structured multi-section report from provided section notes. ' +
    'Each section is expanded and written in the chosen tone. ' +
    'Requires human approval before the report is finalised.',
  inputSchema: InputSchema,
  requiresApproval: true,  // Phase 11 will pause execution here
  timeoutMs: 60_000,

  async execute(input, _ctx: ToolContext): Promise<ToolResult> {
    const client = new OpenAI({
      baseURL: env.OLLAMA_BASE_URL,
      apiKey: env.OLLAMA_API_KEY,
    });

    const toneMap = {
      formal: 'formal and professional',
      casual: 'conversational and friendly',
      technical: 'precise and technical',
    };

    const sectionList = input.sections
      .map((s, i) => `Section ${i + 1}: ${s.heading}\nNotes: ${s.content}`)
      .join('\n\n');

    const prompt =
      `Write a ${toneMap[input.tone]} report titled "${input.title}". ` +
      `Use the following sections (expand each with the provided notes):\n\n${sectionList}\n\n` +
      `Format the output in Markdown with proper headings (##) for each section.`;

    const response = await client.chat.completions.create({
      model: env.OLLAMA_CHAT_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.5,
    });

    const reportMarkdown = response.choices[0]?.message?.content?.trim() ?? '';

    return {
      output: {
        title: input.title,
        markdown: reportMarkdown,
        sectionCount: input.sections.length,
      },
      summary: `Generated "${input.title}" report with ${input.sections.length} section(s)`,
    };
  },
};
