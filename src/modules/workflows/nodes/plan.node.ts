import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { env } from '../../../config/env.js';
import { eventsService } from '../../executions/events.service.js';
import { logger } from '../../../common/logger/logger.js';
import type { AgentState } from '../workflow.types.js';

// ─── Plan node ────────────────────────────────────────────────────────────────
//
// The LLM reads the user's message and produces a short plan.
// It also decides whether retrieval from documents is needed.
//
// Emits: PLANNING event

const PLAN_SYSTEM = `You are a planning assistant. Given a user message, do two things:
1. Write a concise step-by-step plan (2-4 steps max) for answering it.
2. Decide whether the answer requires searching uploaded documents.

Respond in this exact JSON format (no markdown, no explanation):
{"plan": "<your plan>", "needsRetrieval": true|false}`;

export async function planNode(state: AgentState): Promise<Partial<AgentState>> {
  const { tenantId, executionId, input, model, temperature } = state;

  await eventsService.appendEvent(tenantId, state.chatId, executionId, 'PLANNING', {
    input,
  });

  try {
    const llm = new ChatOpenAI({
      model,
      temperature,
      configuration: {
        baseURL: env.OLLAMA_BASE_URL,
        apiKey: env.OLLAMA_API_KEY,
      },
    });

    const response = await llm.invoke([
      new SystemMessage(PLAN_SYSTEM),
      new HumanMessage(input),
    ]);

    const text = typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);

    let plan = text;
    let needsRetrieval = false;

    try {
      // Strip potential markdown code fences
      const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
      const parsed = JSON.parse(cleaned) as { plan: string; needsRetrieval: boolean };
      plan = parsed.plan;
      needsRetrieval = Boolean(parsed.needsRetrieval);
    } catch {
      // LLM didn't return valid JSON — use the raw text as the plan, no retrieval
      logger.warn({ executionId }, 'plan node: LLM returned non-JSON, using raw text');
    }

    logger.debug({ executionId, plan, needsRetrieval }, 'plan node complete');

    return { plan, needsRetrieval };
  } catch (err: any) {
    logger.error({ err, executionId }, 'plan node failed');
    return { error: err.message, plan: null, needsRetrieval: false };
  }
}
