// ─── App factory ─────────────────────────────────────────────────────────────
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
import { redisRateLimit } from './common/middleware/rate-limit.js';

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
import { ragRouter } from './modules/rag/rag.routes.js';
import { streamingRouter } from './modules/streaming/streaming.routes.js';
import { checkpointsRouter } from './modules/checkpoints/checkpoints.routes.js';
import { approvalsRouter } from './modules/approvals/approvals.routes.js';
import { tenantsRouter } from './modules/tenants/tenants.routes.js';

export function createApp(): express.Application {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGINS,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-correlation-id', 'Last-Event-ID'],
      exposedHeaders: ['x-correlation-id'],
    }),
  );
  app.use(express.json({ limit: env.BODY_LIMIT }));
  app.use(express.urlencoded({ extended: true, limit: env.BODY_LIMIT }));
  app.use(correlationId());
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).correlationId,
      autoLogging: { ignore: (req) => req.url?.startsWith('/api/v1/health') ?? false },
      customLogLevel: (_req, res) => {
        if (res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
    }),
  );

  const v1 = express.Router();

  // Public
  v1.use('/health', healthRouter);
  v1.use('/auth', authRouter);

  // Authenticated
  v1.use(authenticate());
  v1.use(redisRateLimit({ scope: 'api' }));

  v1.use('/users', usersRouter);
  v1.use('/chats', chatsRouter);
  v1.use('/messages', messagesRouter);
  v1.use('/executions', executionsRouter);  // CRUD + cancel + step + tool-calls + events
  v1.use('/executions', streamingRouter);   // SSE stream
  v1.use('/executions', checkpointsRouter); // debug checkpoints
  v1.use('/agents', agentsRouter);
  v1.use('/tools', toolsRouter);
  v1.use('/workflows', workflowsRouter);
  v1.use('/memory', memoryRouter);
  v1.use('/documents', documentsRouter);
  v1.use('/rag', ragRouter);
  v1.use('/approvals', approvalsRouter);
  v1.use('/tenants', tenantsRouter);

  app.use('/api/v1', v1);
  app.use(notFound());
  app.use(errorHandler());

  return app;
}
