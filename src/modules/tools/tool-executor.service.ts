import { toolRegistry } from './tool-registry.js';
import { toolCallRepository } from './tool-call.repository.js';
import { eventsService } from '../executions/events.service.js';
import { hashToolInput } from '../checkpoints/checkpoint.service.js';
import { prisma } from '../../db/prisma.js';
import { AppError } from '../../common/errors/AppError.js';
import { logger } from '../../common/logger/logger.js';
import type { ToolContext } from './tool.types.js';

const DEFAULT_TIMEOUT_MS = 30_000;

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
    const { tenantId, executionId } = ctx;

    // ── 1. Lookup ────────────────────────────────────────────────────────────
    const tool = toolRegistry.get(toolName);

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

    // ── 3. Idempotency check ─────────────────────────────────────────────────
    // On a worker retry, a tool call for the same (executionId, toolName, input)
    // may have already completed. Reuse the output instead of calling again.
    const inputHash = hashToolInput(toolName, validatedInput);

    const existing = await prisma.toolCall.findFirst({
      where: {
        executionId,
        toolName,
        status: 'SUCCESS',
        // We store the hash in the input JSON under a __hash key
        input: { path: ['__hash'], equals: inputHash },
      },
    });

    if (existing) {
      logger.info(
        { toolName, toolCallId: existing.id, executionId },
        'ToolExecutor: reusing existing SUCCESS result (idempotency)',
      );
      return {
        toolCallId: existing.id,
        toolName,
        status: 'SUCCESS' as const,
        ...(existing.output ? { output: existing.output as Record<string, unknown> } : {}),
        durationMs: 0,
      };
    }

    // ── 4. Create ToolCall row (PENDING) — embed hash for future idempotency ─
    const toolCall = await toolCallRepository.create({
      tenantId,
      executionId,
      toolName,
      input: { ...validatedInput, __hash: inputHash } as any,
      status: 'PENDING',
    });

    // ── 5. Emit CALLING_TOOL ─────────────────────────────────────────────────
    await eventsService.appendEvent(tenantId, '', executionId, 'CALLING_TOOL', {
      toolCallId: toolCall.id,
      toolName,
      input: validatedInput,
      requiresApproval: tool.requiresApproval ?? false,
    });

    const startedAt = Date.now();

    // ── 6. Mark RUNNING ──────────────────────────────────────────────────────
    await toolCallRepository.markRunning(toolCall.id);

    // ── 7. Emit EXECUTING_TOOL ───────────────────────────────────────────────
    await eventsService.appendEvent(tenantId, '', executionId, 'EXECUTING_TOOL', {
      toolCallId: toolCall.id,
      toolName,
    });

    const timeoutMs = tool.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    try {
      // ── 8. Execute with timeout ──────────────────────────────────────────
      const output = await Promise.race([
        tool.execute(validatedInput as any, ctx),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Tool "${toolName}" timed out after ${timeoutMs}ms`)),
            timeoutMs,
          ),
        ),
      ]);

      const durationMs = Date.now() - startedAt;

      // ── 9a. Success ──────────────────────────────────────────────────────
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
      const isTimeout = (err.message as string).includes('timed out');
      const errorPayload = {
        message: err.message ?? 'Unknown error',
        code: isTimeout ? 'TIMEOUT' : (err.code ?? 'TOOL_ERROR'),
      };

      if (isTimeout) {
        await toolCallRepository.markCancelled(toolCall.id);
        logger.warn({ toolName, toolCallId: toolCall.id, durationMs }, 'Tool call timed out');
      } else {
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
