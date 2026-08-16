// ─── Worker entry point ───────────────────────────────────────────────────────
//
// Phase 01: stub only.
//
// Phase 09 will initialise BullMQ workers here. The worker process shares
// modules (DB, Redis, services, workflows) with the API but does NOT start
// an HTTP server. It runs entirely in the background, independent of
// any HTTP request or SSE connection.
//
// Run with: npm run worker

import { logger } from './common/logger/logger.js';

logger.info('AgentForge worker starting (Phase 01 stub — no jobs registered yet)');

// Keeps the process alive. Phase 09 replaces this with BullMQ worker registration.
process.on('SIGTERM', () => {
  logger.info('Worker received SIGTERM — exiting');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('Worker received SIGINT — exiting');
  process.exit(0);
});
