import { ChatOpenAI } from '@langchain/openai';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { eventsService } from '../../executions/events.service.js';
import { env } from '../../../config/env.js';
import { logger } from '../../../common/logger/logger.js';
import type { AgentState } from '../workflow.types.js';

// ─── Respond node ─────────────────────────────────────────────────────────────
//
// Produces the final assistant response.  If the reason node already set
// `state.response` (because it chose a direct answer), we skip the extra LLM
// call and emit deltas from the existing text.  Otherwise we invoke the LLM
// one more time with full context.
//
// Emits: GENERATING_RESPONSE, RESPONSE_DELTA (one per ~sentence), RESPONSE_COMPLETED

const CHUNK_SIZE = 80; // characters per delta chunk

function splitIntoDeltaChunks(text: string): string[] {
  // Split on sentence boundaries first, then fall back to fixed-size chunks.
  const sentences = text.match(/[^.!?]+[.!?]+|\s*\n+\s*|[^.!?\n]+$/g) ?? [text];
  const chunks: string[] = [];
  for (const sentence of sentences) {
    // Further split sentences longer than CHUNK_SIZE
    for (let i = 0; i < sentence.length; i += CHUNK_SIZE) {
      chunks.push(sentence.slice(i, i + CHUNK_SIZE));
    }
  }
  return chunks.filter((c) => c.length > 0);
}

export async function respondNode(state: AgentState): Promise<Partial<AgentState>> {
  const {
    tenantId, executionId, chatId,
    input, systemPrompt, model, temperature,
    plan, retrievedChunks, observations,
  } = state;

  await eventsService.appendEvent(tenantId, chatId, executionId, 'GENERATING_RESPONSE', {});

  let finalResponse = state.response;

  // If reason node didn't set a response, call the LLM now with full context
  if (!finalResponse) {
    let contextBlock = '';
    if (retrievedChunks.length > 0) {
      contextBlock = '\n\n## Document context\n' +
        retrievedChunks.map((c, i) => `[${i + 1}] ${c.content}`).join('\n\n');
    }
    let observationsBlock = '';
    if (observations.length > 0) {
      observationsBlock = '\n\n## Tool observations\n' +
        observations.map((o, i) => `${i + 1}. ${o}`).join('\n');
    }

    let memoriesBlock = '';
    if (state.retrievedMemories?.length > 0) {
      memoriesBlock = '\n\n## Long-term memory\n' +
        state.retrievedMemories.map((m) => `- [${m.kind}] ${m.content}`).join('\n');
    }

    const systemContent =
      systemPrompt +
      (plan ? `\n\n## Plan\n${plan}` : '') +
      memoriesBlock +
      contextBlock +
      observationsBlock +
      '\n\nNow produce a clear, helpful final answer.';

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
        new SystemMessage(systemContent),
        new HumanMessage(input),
        ...state.messages,
      ]);

      finalResponse = typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);
    } catch (err: any) {
      logger.error({ err, executionId }, 'respond node LLM call failed');
      finalResponse = 'I encountered an error while generating a response. Please try again.';
    }
  }

  // Emit response as delta chunks so the SSE client can render progressively
  const chunks = splitIntoDeltaChunks(finalResponse);
  for (const chunk of chunks) {
    await eventsService.appendEvent(tenantId, chatId, executionId, 'RESPONSE_DELTA', {
      text: chunk,
    });
  }

  await eventsService.appendEvent(tenantId, chatId, executionId, 'RESPONSE_COMPLETED', {
    length: finalResponse.length,
  });

  logger.debug({ executionId, length: finalResponse.length }, 'respond node complete');

  return { response: finalResponse };
}
