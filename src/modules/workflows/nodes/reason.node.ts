import { ChatOpenAI } from '@langchain/openai';
import { SystemMessage, HumanMessage, AIMessage } from '@langchain/core/messages';
import { toolRegistry } from '../../tools/tool-registry.js';
import { eventsService } from '../../executions/events.service.js';
import { env } from '../../../config/env.js';
import { logger } from '../../../common/logger/logger.js';
import type { AgentState } from '../workflow.types.js';

// ─── Reason node ──────────────────────────────────────────────────────────────
//
// The core ReAct reasoning step.  The LLM sees:
//   - system prompt + plan
//   - retrieved document context (if any)
//   - the user's message
//   - all previous observations from act/observe cycles
//
// It either calls a tool OR returns a final answer.
//
// Emits: THINKING event

export async function reasonNode(state: AgentState): Promise<Partial<AgentState>> {
  const {
    tenantId, executionId, chatId,
    input, systemPrompt, model, temperature,
    plan, retrievedChunks, observations, loopCount,
  } = state;

  await eventsService.appendEvent(tenantId, chatId, executionId, 'THINKING', {
    loopCount,
    plan,
  });

  // ── Build context string from retrieved chunks ───────────────────────────
  let contextBlock = '';
  if (retrievedChunks.length > 0) {
    contextBlock = '\n\n## Relevant document context\n' +
      retrievedChunks.map((c, i) => `[${i + 1}] ${c.content}`).join('\n\n');
  }

  // ── Build observations block ─────────────────────────────────────────────
  let observationsBlock = '';
  if (observations.length > 0) {
    observationsBlock = '\n\n## Previous observations\n' +
      observations.map((o, i) => `Observation ${i + 1}: ${o}`).join('\n');
  }

  const systemContent =
    systemPrompt +
    (plan ? `\n\n## Plan\n${plan}` : '') +
    contextBlock +
    observationsBlock;

  // ── Bind tools to the LLM ─────────────────────────────────────────────────
  // Convert our ToolManifest format to the OpenAI tool format LangChain expects.
  const manifests = toolRegistry.manifests();
  const tools = manifests.map((m) => ({
    type: 'function' as const,
    function: {
      name: m.name,
      description: m.description,
      parameters: m.parameters,
    },
  }));

  try {
    const llm = new ChatOpenAI({
      model,
      temperature,
      configuration: {
        baseURL: env.OLLAMA_BASE_URL,
        apiKey: env.OLLAMA_API_KEY,
      },
    });

    const llmWithTools = llm.bindTools(tools);

    // Build message history: system + past messages + user input
    const msgs = [
      new SystemMessage(systemContent),
      new HumanMessage(input),
      ...state.messages, // prior AI + Tool messages from previous loops
    ];

    const response = await llmWithTools.invoke(msgs);

    // Check if the LLM wants to call a tool
    const toolCalls = (response as any).tool_calls ?? (response as any).additional_kwargs?.tool_calls;

    if (toolCalls && toolCalls.length > 0) {
      const call = toolCalls[0];
      const toolName: string = call.name ?? call.function?.name ?? '';
      let toolInput: Record<string, unknown> = {};

      try {
        const rawArgs = call.args ?? call.function?.arguments ?? '{}';
        toolInput = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs;
      } catch {
        toolInput = {};
      }

      logger.debug({ executionId, toolName, toolInput }, 'reason node: tool call requested');

      // Append the AI message to history so the next reason loop has context
      const updatedMessages = [...state.messages, response as AIMessage];

      return {
        pendingToolName: toolName,
        pendingToolInput: toolInput,
        messages: updatedMessages,
        loopCount: loopCount + 1,
      };
    }

    // No tool call — LLM wants to respond directly
    const responseText = typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);

    logger.debug({ executionId }, 'reason node: direct response chosen');

    return {
      pendingToolName: null,
      pendingToolInput: null,
      response: responseText,
      messages: [...state.messages, response as AIMessage],
      loopCount: loopCount + 1,
    };
  } catch (err: any) {
    logger.error({ err, executionId }, 'reason node failed');
    return { error: err.message };
  }
}
