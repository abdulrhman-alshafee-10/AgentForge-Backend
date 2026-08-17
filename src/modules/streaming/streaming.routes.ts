import { Router, type Request, type Response } from 'express';
import { executionOwnership } from '../../common/middleware/execution-ownership.js';
import { createRedisSubscriber } from '../../redis/redis.js';
import { eventsService } from '../executions/events.service.js';
import { logger } from '../../common/logger/logger.js';

const router = Router({ mergeParams: true });

// ─── Terminal event types ─────────────────────────────────────────────────────
const TERMINAL_EVENTS = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

/**
 * GET /executions/:executionId/stream
 *
 * Server-Sent Events endpoint for real-time execution updates.
 *
 * Protocol:
 *  1. Set SSE headers and flush immediately.
 *  2. Emit a CONNECTED frame.
 *  3. Replay all persisted events with sequence > Last-Event-ID from Postgres.
 *  4. Subscribe to the execution's Redis channel for live events.
 *     - Only forward events whose sequence > the highest replayed sequence
 *       to prevent duplicates during the replay/live handoff window.
 *  5. Send `: ping` heartbeats every 15 seconds.
 *  6. Close the stream on terminal events (COMPLETED / FAILED / CANCELLED)
 *     or when the client disconnects.
 *
 * Each SSE frame uses the event's sequence number as the `id` field so
 * reconnecting clients can supply `Last-Event-ID` to resume without gaps.
 */
router.get(
  '/:executionId/stream',
  executionOwnership(),
  async (req: Request, res: Response) => {
    const executionId = req.params.executionId as string;

    // ── Parse Last-Event-ID ──────────────────────────────────────────────────
    // Prefer the standard header; fall back to the query param for clients
    // that cannot set custom headers (e.g., EventSource in a browser).
    const lastEventIdStr =
      req.header('Last-Event-ID') ?? (req.query.lastEventId as string | undefined);
    // afterSequence is the highest sequence already seen by the client.
    // On fresh connect this is 0 (replay everything).
    const afterSequence = lastEventIdStr ? parseInt(lastEventIdStr, 10) : 0;

    // ── 1. SSE headers ───────────────────────────────────────────────────────
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable Nginx / proxy buffering
    // Flush headers immediately so the browser starts the stream.
    res.flushHeaders();

    // ── Helper: write a single SSE event frame ───────────────────────────────
    function writeEvent(id: number | bigint, type: string, payload: unknown): void {
      res.write(`id: ${id}\n`);
      res.write(`event: ${type}\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    }

    // ── 2. CONNECTED frame ───────────────────────────────────────────────────
    writeEvent(afterSequence, 'CONNECTED', {
      status: req.execution!.status,
      lastSequence: afterSequence,
    });

    // ── 3. Replay missed events from Postgres ────────────────────────────────
    // highWaterMark tracks the highest sequence we have sent so the live
    // subscriber can discard events that arrived during replay.
    let highWaterMark = afterSequence;

    try {
      let cursor: string | undefined = undefined;
      let hasMore = true;

      while (hasMore) {
        const page = await eventsService.getEvents(executionId, 100, cursor, afterSequence);
        for (const event of page.items) {
          const seq = Number(event.sequence);
          writeEvent(seq, event.type, event.payload);
          if (seq > highWaterMark) highWaterMark = seq;

          // If the execution already ended, close immediately after replay.
          if (TERMINAL_EVENTS.has(event.type)) {
            res.end();
            return;
          }
        }
        hasMore = page.nextCursor !== null;
        cursor = page.nextCursor ?? undefined;
      }
    } catch (err) {
      logger.error({ err, executionId }, 'SSE: failed to replay events');
      res.end();
      return;
    }

    // ── 4. Live subscribe via a dedicated Redis connection ───────────────────
    // ioredis requires a *separate* client for pub/sub because subscribing
    // puts the connection into subscriber mode, making it unusable for other commands.
    const channel = `execution:${executionId}`;
    const subscriber = createRedisSubscriber();

    let closed = false;

    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      // Unsubscribe and quit the per-request subscriber connection.
      subscriber.unsubscribe(channel).catch(() => {});
      subscriber.quit().catch(() => {});
    };

    subscriber.on('message', (ch: string, message: string) => {
      if (ch !== channel) return;
      try {
        const event = JSON.parse(message) as { sequence: number; type: string; payload: unknown };
        const seq = Number(event.sequence);

        // Guard: skip events already sent during replay.
        if (seq <= highWaterMark) return;
        highWaterMark = seq;

        writeEvent(seq, event.type, event.payload);

        if (TERMINAL_EVENTS.has(event.type)) {
          cleanup();
          res.end();
        }
      } catch (err) {
        logger.error({ err, executionId }, 'SSE: error handling live event');
      }
    });

    subscriber.on('error', (err: Error) => {
      logger.error({ err, executionId }, 'SSE: Redis subscriber error');
      // Events are still in Postgres; client can reconnect and replay.
      cleanup();
      res.end();
    });

    await subscriber.subscribe(channel).catch((err) => {
      logger.error({ err, executionId }, 'SSE: failed to subscribe to Redis channel');
      cleanup();
      res.end();
    });

    // ── 5. Heartbeat ─────────────────────────────────────────────────────────
    // Keeps proxies and load balancers from closing idle connections.
    const heartbeat = setInterval(() => {
      res.write(': ping\n\n');
    }, 15_000);

    // ── 6. Client disconnect ─────────────────────────────────────────────────
    req.on('close', cleanup);
  },
);

export { router as streamingRouter };
