import OpenAI from 'openai';
import { prisma } from '../../db/prisma.js';
import { memoryService } from './memory.service.js';
import { env } from '../../config/env.js';
import { logger } from '../../common/logger/logger.js';

// ─── Max memories extracted per execution ────────────────────────────────────
const MAX_MEMORIES = 3;

// ─── Summarizer Service ───────────────────────────────────────────────────────
//
// After an execution completes, this service:
//   1. Loads the conversation (user + assistant messages).
//   2. Asks the LLM to extract up to MAX_MEMORIES durable facts or preferences.
//   3. Saves each as a Memory row with deduplication.

const EXTRACT_SYSTEM = `You are a memory extraction assistant.
Given a conversation, extract up to ${MAX_MEMORIES} durable facts or preferences worth remembering about the user.
Focus on stable information (preferences, domain facts, personal context) — not ephemeral details.

Respond with a JSON array of objects. Each object must have:
  - "kind": one of "preference", "fact", "note"
  - "content": a concise, self-contained sentence (max 200 chars)
  - "key": optional stable identifier (snake_case, e.g. "preferred_language")

Example:
[{"kind":"preference","content":"The user prefers bullet-point summaries.","key":"summary_style"},
 {"kind":"fact","content":"The user works in healthcare IT.","key":"user_industry"}]

If there is nothing worth remembering, return an empty array: []
Do not add markdown fences. Return raw JSON only.`;

export class SummarizerService {
  async extractAndSave(options: {
    executionId: string;
    tenantId: string;
    userId: string;
    chatId: string;
  }): Promise<number> {
    const { executionId, tenantId, userId, chatId } = options;

    // Load messages for this execution
    const messages = await prisma.message.findMany({
      where: { executionId },
      orderBy: { createdAt: 'asc' },
      select: { role: true, content: true },
    });

    if (messages.length < 2) return 0; // Nothing meaningful to summarise

    const transcript = messages
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n');

    try {
      const client = new OpenAI({
        baseURL: env.OLLAMA_BASE_URL,
        apiKey: env.OLLAMA_API_KEY,
      });

      const response = await client.chat.completions.create({
        model: env.OLLAMA_CHAT_MODEL,
        messages: [
          { role: 'system', content: EXTRACT_SYSTEM },
          { role: 'user', content: transcript },
        ],
        temperature: 0.2,
      });

      const raw = response.choices[0]?.message?.content?.trim() ?? '[]';
      const cleaned = raw.replace(/```json\n?|\n?```/g, '').trim();

      let extracted: Array<{ kind: string; content: string; key?: string }> = [];
      try {
        extracted = JSON.parse(cleaned);
        if (!Array.isArray(extracted)) extracted = [];
      } catch {
        logger.warn({ executionId }, 'SummarizerService: LLM returned non-JSON');
        return 0;
      }

      const valid = extracted
        .filter((e) => e.content && ['preference', 'fact', 'note', 'summary'].includes(e.kind))
        .slice(0, MAX_MEMORIES);

      let saved = 0;
      for (const item of valid) {
        try {
          await memoryService.save({
            tenantId,
            userId,
            chatId,
            kind: item.kind as any,
            content: item.content,
            ...(item.key ? { key: item.key } : {}),
            metadata: { extractedFromExecution: executionId },
          });
          saved++;
        } catch (err) {
          logger.warn({ err, executionId }, 'SummarizerService: failed to save one memory');
        }
      }

      logger.info({ executionId, saved }, 'SummarizerService: memories extracted');
      return saved;
    } catch (err) {
      // Non-fatal — memory extraction should never fail an execution
      logger.warn({ err, executionId }, 'SummarizerService: extraction failed');
      return 0;
    }
  }
}

export const summarizerService = new SummarizerService();
