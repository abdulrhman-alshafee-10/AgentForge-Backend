import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { validate } from '../../common/middleware/validate.js';
import { wrap } from '../../common/utils/async-wrap.js';
import { chatOwnership } from '../../common/middleware/chat-ownership.js';
import { PaginationSchema } from '../../common/utils/pagination.js';
import { executionsService } from './executions.service.js';
import { executionOwnership } from '../../common/middleware/execution-ownership.js';
import { eventsService } from './events.service.js';
import { toolCallRepository } from '../tools/tool-call.repository.js';
import { toolExecutorService } from '../tools/tool-executor.service.js';
import { prisma } from '../../db/prisma.js';
import { ConflictError } from '../../common/errors/HttpErrors.js';

const router = Router({ mergeParams: true });

// ─── Events query schema ──────────────────────────────────────────────────────

const EventsQuerySchema = PaginationSchema.extend({
  afterSequence: z.coerce.number().int().min(0).optional(),
});

// ─── Step (stub agent) body schema ───────────────────────────────────────────

const StepBodySchema = z.object({
  toolName: z.string().min(1),
  input: z.record(z.unknown()).default({}),
});

// ─── GET /executions/:executionId ─────────────────────────────────────────────

router.get(
  '/:executionId',
  executionOwnership(),
  wrap(async (req: Request, res: Response) => {
    res.json({ execution: req.execution });
  }),
);

// ─── GET /executions/:executionId/events ──────────────────────────────────────

router.get(
  '/:executionId/events',
  executionOwnership(),
  validate({ query: EventsQuerySchema }),
  wrap(async (req: Request, res: Response) => {
    const query = req.query as unknown as z.infer<typeof EventsQuerySchema>;
    const result = await eventsService.getEvents(
      req.params.executionId!,
      query.limit,
      query.cursor,
      query.afterSequence,
    );
    res.json(result);
  }),
);

// ─── GET /executions/:executionId/tool-calls ──────────────────────────────────
//
// Returns all ToolCall rows for an execution in chronological order.

router.get(
  '/:executionId/tool-calls',
  executionOwnership(),
  wrap(async (req: Request, res: Response) => {
    const toolCalls = await toolCallRepository.findByExecution(req.params.executionId!);
    res.json({ items: toolCalls });
  }),
);

// ─── POST /executions/:executionId/cancel ─────────────────────────────────────
//
// Signals that the execution should be cancelled.  Idempotent: calling on an
// already-terminal execution returns the current state without error.
// Phase 09 will propagate the signal to the running worker.

router.post(
  '/:executionId/cancel',
  executionOwnership(),
  wrap(async (req: Request, res: Response) => {
    const execution = req.execution!;
    const terminalStatuses = ['COMPLETED', 'FAILED', 'CANCELLED'];

    if (terminalStatuses.includes(execution.status)) {
      // Already terminal — idempotent, just return current state.
      res.json({ execution });
      return;
    }

    const updated = await prisma.execution.update({
      where: { id: execution.id },
      data: { status: 'CANCELLED', finishedAt: new Date() },
    });

    await eventsService.appendEvent(
      execution.tenantId,
      execution.chatId,
      execution.id,
      'CANCELLED',
      { cancelledBy: req.user!.id },
    );

    res.json({ execution: updated });
  }),
);

// ─── POST /executions/:executionId/step ───────────────────────────────────────
//
// Stub agent endpoint: manually invoke a single tool for testing without a
// real LLM.  Accepts { toolName, input } and runs the full tool-executor
// pipeline (persist ToolCall, emit events, enforce timeout).
//
// This endpoint exists for Phase 07 testing only.
// Phase 08 replaces manual stepping with a LangGraph-driven workflow.

router.post(
  '/:executionId/step',
  executionOwnership(),
  validate({ body: StepBodySchema }),
  wrap(async (req: Request, res: Response) => {
    const execution = req.execution!;
    const nonRunnable = ['COMPLETED', 'FAILED', 'CANCELLED'];

    if (nonRunnable.includes(execution.status)) {
      throw new ConflictError(
        `Cannot step an execution with status "${execution.status}"`,
      );
    }

    const { toolName, input } = req.body as z.infer<typeof StepBodySchema>;

    const result = await toolExecutorService.invoke({
      toolName,
      rawInput: input,
      ctx: {
        tenantId: req.user!.tenantId,
        userId: req.user!.id,
        executionId: execution.id,
      },
    });

    res.json({ result });
  }),
);

// ─── GET /chats/:chatId/executions ────────────────────────────────────────────
// Mounted under /chats/:chatId/executions via the chats router.

router.get(
  '/',
  chatOwnership(),
  validate({ query: PaginationSchema }),
  wrap(async (req: Request, res: Response) => {
    const query = req.query as unknown as { cursor?: string; limit: number };
    const result = await executionsService.listExecutions(
      req.params.chatId!,
      query.limit,
      query.cursor,
    );
    res.json(result);
  }),
);

export { router as executionsRouter };
