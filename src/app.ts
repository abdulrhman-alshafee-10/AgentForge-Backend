import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import pinoHttp from 'pino-http';

import { env } from './config/env.js';
import { logger } from './common/logger/logger.js';
import { correlationId } from './common/middleware/correlation-id.js';
import { notFound } from './common/middleware/not-found.js';
import { errorHandler } from './common/middleware/error-handler.js';
import { authenticate } from './common/middleware/authenticate.js';

// ── Routers ───────────────────────────────────────────────────────────────────
import { healthRouter } from './modules/health/health.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { usersRouter } from './modules/users/users.routes.js';
import { chatsRouter } from './modules/chats/chats.routes.js';
import { messagesRouter } from './modules/messages/messages.routes.js';
import { executionsRouter } from './modules/executions/executions.routes.js';
import { agentsRouter } from './modules/agents/agents.routes.js';
import { toolsRouter } from './modules/tools/tools.routes.js';
import { workflowsRouter } from './modules/workflows/workflows.routes.js';
import { memoryRouter } from './modules/memory/memory.routes.js';
import { documentsRouter } from './modules/documents/documents.routes.js';
import { streamingRouter } from './modules/streaming/streaming.routes.js';
import { checkpointsRouter } from './modules/checkpoints/checkpoints.routes.js';
import { approvalsRouter } from './modules/approvals/approvals.routes.js';
import { tenantsRouter } from './modules/tenants/tenants.routes.js';

// ─── App factory ──────────────────────────────────────────────────────────────
//
// Returns the configured Express application WITHOUT binding to a port.
// This keeps the app testable: tests can import createApp() and pass it
// to supertest without needing a real network socket.

export function createApp(): express.Application {
  const app = express();

  // ── 1. Security headers ──────────────────────────────────────────────────
  app.use(helmet());

  // ── 2. CORS ──────────────────────────────────────────────────────────────
  app.use(
    cors({
      origin: env.CORS_ORIGINS,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'x-correlation-id',
        'Last-Event-ID',
      ],
      exposedHeaders: ['x-correlation-id'],
    }),
  );

  // ── 3. Body parsing ──────────────────────────────────────────────────────
  app.use(express.json({ limit: env.BODY_LIMIT }));
  app.use(express.urlencoded({ extended: true, limit: env.BODY_LIMIT }));

  // ── 4. Correlation ID ────────────────────────────────────────────────────
  app.use(correlationId());

  // ── 5. Structured HTTP logging ───────────────────────────────────────────
  app.use(
    pinoHttp({
      logger,
      // Attach correlation ID from req so every log line carries it
      genReqId: (req) => (req as express.Request).correlationId,
      // Silence health checks from logs to reduce noise
      autoLogging: {
        ignore: (req) => req.url?.startsWith('/api/v1/health') ?? false,
      },
      customLogLevel: (_req, res) => {
        if (res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
    }),
  );

  // ── 6. API v1 routers ────────────────────────────────────────────────────
  const v1 = express.Router();

  // Public routes — no authentication required
  v1.use('/health', healthRouter);
  v1.use('/auth', authRouter);

  // Apply authentication to all remaining /api/v1/* routes
  v1.use(authenticate());

  v1.use('/users', usersRouter);
  v1.use('/chats', chatsRouter);
  v1.use('/messages', messagesRouter);
  // executionsRouter handles both GET /executions/:id, GET /executions/:id/events,
  // and GET /executions/:id/stream (SSE). All live under /executions.
  v1.use('/executions', executionsRouter);
  v1.use('/executions', streamingRouter);
  v1.use('/agents', agentsRouter);
  v1.use('/tools', toolsRouter);
  v1.use('/workflows', workflowsRouter);
  v1.use('/memory', memoryRouter);
  v1.use('/documents', documentsRouter);
  v1.use('/checkpoints', checkpointsRouter);
  v1.use('/approvals', approvalsRouter);
  v1.use('/tenants', tenantsRouter);

  app.use('/api/v1', v1);

  // ── 7. 404 – no route matched ────────────────────────────────────────────
  app.use(notFound());

  // ── 8. Global error handler (must be last, must have 4 params) ───────────
  app.use(errorHandler());

  return app;
}
