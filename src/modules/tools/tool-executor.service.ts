import { toolRegistry } from './tool-registry.js';
import { toolCallRepository } from './tool-call.repository.js';
import { eventsService } from '../executions/events.service.js';
import { AppError } from '../../common/errors/AppError.js';
import { logger } from '../../common/logger/logger.js';
import type { ToolContext } from './tool.types.js';

// ─── Default per-tool timeout ─────────────────────────────────────────────────
const DEFAULT_TIMEOUT_MS = 30_000;

// ─── Tool Executor Service ────────────────────────────────────────────────────
//
// Orchestrates a single tool call end-to-end:
//
//  1. Lookup tool in registry → 404 if unknown.
//  2. Validate raw input against the tool's Zod schema → VALIDATION_ERROR if bad.
//  3. Create a ToolCall row (PENDING).
//  4. Emit CALLING_TOOL event.
//  5. Transition row to RUNNING.
//  6. Emit EXECUTING_TOOL event.
//  7. Run the executor with a timeout guard.
//  8a. On success: persist output, mark SUCCESS, emit TOOL_RESULT.
//  8b. On timeout: mark CANCELLED, emit TOOL_RESULT with error payload.
//  8c. On error: mark ERROR, emit TOOL_RESULT with error payload.
//
// All events flow through eventsService so the SSE stream picks them up.

export interface InvokeToolOptions {
  toolName: string;
  rawInput: Record<string, unknown>;
  ctx: ToolContext;
}

export interface InvokeToolResult {
  toolCallId: string;
  toolName: string;
  status: 'SUCCESS' | 'ERROR' | 'CANCELLED';
  output?: Record<string, unknown>;
  error?: Record<string, unknown>;
  durationMs: number;
}

export class ToolExecutorService {
  async invoke(options: InvokeToolOptions): Promise<InvokeToolResult> {
    const { toolName, rawInput, ctx } = options;
    const { tenantId, userId, executionId } = ctx;

    // ── 1. Lookup ────────────────────────────────────────────────────────────
    const tool = toolRegistry.get(toolName); // throws NOT_FOUND if missing

    // ── 2. Validate input ────────────────────────────────────────────────────
    const parseResult = tool.inputSchema.safeParse(rawInput);
    if (!parseResult.success) {
      throw new AppError(
        `Invalid input for tool "${toolName}": ${parseResult.error.message}`,
        400,
        'VALIDATION_ERROR',
        parseResult.error.issues,
      );
    }
    const validatedInput = parseResult.data as Record<string, unknown>;

    // ── 3. Create ToolCall row (PENDING) ─────────────────────────────────────
    const toolCall = await toolCallRepository.create({
      tenantId,
      executionId,
      toolName,
      input: validatedInput as any,
      status: 'PENDING',
    });

    // ── 4. Emit CALLING_TOOL ─────────────────────────────────────────────────
    // We need chatId for eventsService — load it from the execution.
    // To avoid a DB round-trip in the common path we embed executionId only;
    // the stream handler already knows the chat from context.
    await eventsService.appendEvent(tenantId, '', executionId, 'CALLING_TOOL', {
      toolCallId: toolCall.id,
      toolName,
      input: validatedInput,
      requiresApproval: tool.requiresApproval ?? false,
    });

    const startedAt = Date.now();

    // ── 5. Mark RUNNING ──────────────────────────────────────────────────────
    await toolCallRepository.markRunning(toolCall.id);

    // ── 6. Emit EXECUTING_TOOL ───────────────────────────────────────────────
    await eventsService.appendEvent(tenantId, '', executionId, 'EXECUTING_TOOL', {
      toolCallId: toolCall.id,
      toolName,
    });

    const timeoutMs = tool.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    try {
      // ── 7. Execute with timeout ──────────────────────────────────────────
      const output = await Promise.race([
        tool.execute(validatedInput as any, ctx),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Tool "${toolName}" timed out after ${timeoutMs}ms`)), timeoutMs),
        ),
      ]);

      const durationMs = Date.now() - startedAt;

      // ── 8a. Success ──────────────────────────────────────────────────────
      await toolCallRepository.markSuccess(toolCall.id, output.output as any);

      await eventsService.appendEvent(tenantId, '', executionId, 'TOOL_RESULT', {
        toolCallId: toolCall.id,
        toolName,
        status: 'SUCCESS',
        output: output.output,
        summary: output.summary,
        durationMs,
      });

      logger.info({ toolName, toolCallId: toolCall.id, durationMs }, 'Tool call succeeded');

      return {
        toolCallId: toolCall.id,
        toolName,
        status: 'SUCCESS',
        output: output.output,
        durationMs,
      };
    } catch (err: any) {
      const durationMs = Date.now() - startedAt;
      const isTimeout = err.message?.includes('timed out');
      const errorPayload = {
        message: err.message ?? 'Unknown error',
        code: isTimeout ? 'TIMEOUT' : (err.code ?? 'TOOL_ERROR'),
      };

      if (isTimeout) {
        // ── 8b. Timeout ────────────────────────────────────────────────────
        await toolCallRepository.markCancelled(toolCall.id);
        logger.warn({ toolName, toolCallId: toolCall.id, durationMs }, 'Tool call timed out');
      } else {
        // ── 8c. Error ──────────────────────────────────────────────────────
        await toolCallRepository.markError(toolCall.id, errorPayload as any);
        logger.error({ err, toolName, toolCallId: toolCall.id, durationMs }, 'Tool call errored');
      }

      await eventsService.appendEvent(tenantId, '', executionId, 'TOOL_RESULT', {
        toolCallId: toolCall.id,
        toolName,
        status: isTimeout ? 'CANCELLED' : 'ERROR',
        error: errorPayload,
        durationMs,
      });

      return {
        toolCallId: toolCall.id,
        toolName,
        status: isTimeout ? 'CANCELLED' : 'ERROR',
        error: errorPayload,
        durationMs,
      };
    }
  }
}

export const toolExecutorService = new ToolExecutorService();
