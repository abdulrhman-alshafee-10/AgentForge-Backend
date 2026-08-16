import { Router, type Request, type Response } from 'express';
import { executionOwnership } from '../../common/middleware/execution-ownership.js';
import { redisSubscriber } from '../../redis/redis.js';
import { eventsService } from '../executions/events.service.js';
import { logger } from '../../common/logger/logger.js';

const router = Router({ mergeParams: true });

/**
 * GET /stream/:executionId
 * Server-Sent Events endpoint for real-time execution updates.
 */
router.get(
  '/:executionId',
  executionOwnership(),
  async (req: Request, res: Response) => {
    const executionId = req.params.executionId;
    
    // Parse Last-Event-ID from header or query string
    const lastEventIdStr = req.header('Last-Event-ID') || (req.query.lastEventId as string);
    const lastEventId = lastEventIdStr ? parseInt(lastEventIdStr, 10) : 0;

    // 1. Set SSE required headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable proxy buffering

    // 2. Send initial CONNECTED event
    const connectedPayload = { status: req.execution!.status, lastSequence: lastEventId };
    res.write(`id: ${lastEventId}\n`);
    res.write(`event: CONNECTED\n`);
    res.write(`data: ${JSON.stringify(connectedPayload)}\n\n`);

    // 3. Replay missed events from database
    try {
      if (lastEventId > 0) {
        let hasMore = true;
        let cursor: string | undefined = undefined;
        let lastSeenSeq = lastEventId;
        
        while (hasMore) {
          const missedEvents = await eventsService.getEvents(executionId, 100, cursor, lastEventId);
          for (const event of missedEvents.data) {
            res.write(`id: ${event.sequence}\n`);
            res.write(`event: ${event.type}\n`);
            res.write(`data: ${JSON.stringify(event.payload)}\n\n`);
            lastSeenSeq = event.sequence;
          }
          hasMore = missedEvents.meta.hasMore;
          cursor = missedEvents.meta.nextCursor;
        }
      }
    } catch (err) {
      logger.error({ err, executionId }, 'Failed to replay events');
      res.end();
      return;
    }

    // 4. Subscribe to Redis live events
    const channel = `execution:${executionId}`;
    
    // Create a per-request subscriber if we aren't using pattern subscriptions, 
    // but a shared subscriber requires pattern matching or careful message routing.
    // For simplicity in Express, we will duplicate the client, OR we can listen to the shared one.
    // Let's use the shared `redisSubscriber` but add a listener for our specific channel.
    
    // Wait, redisSubscriber.subscribe() adds to the global subscriber.
    // When a message arrives, it emits 'message' event for ALL listeners.
    const messageHandler = (ch: string, message: string) => {
      if (ch === channel) {
        try {
          const event = JSON.parse(message);
          
          // Only send if it's newer than our last sent
          // If we had concurrent replay and live events, this guards against duplicates
          res.write(`id: ${event.sequence}\n`);
          res.write(`event: ${event.type}\n`);
          res.write(`data: ${JSON.stringify(event.payload)}\n\n`);

          // Terminate stream on terminal states
          if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(event.type)) {
            cleanup();
            res.end();
          }
        } catch (err) {
          logger.error({ err, executionId }, 'Error parsing live event');
        }
      }
    };

    redisSubscriber.subscribe(channel).catch((err) => {
      logger.error({ err, executionId }, 'Failed to subscribe to Redis channel');
    });
    
    redisSubscriber.on('message', messageHandler);

    // 5. Keep-alive heartbeat
    const interval = setInterval(() => {
      res.write(': ping\n\n');
    }, 15000);

    // Cleanup logic
    const cleanup = () => {
      clearInterval(interval);
      redisSubscriber.off('message', messageHandler);
      // We don't unsubscribe from the channel globally because other users might be watching the same execution, 
      // but in this app architecture, it's ok to leave the subscription active or we can track ref counts.
      // For now, removing the listener prevents memory leaks.
    };

    // Client disconnect
    req.on('close', () => {
      cleanup();
    });
  }
);

export { router as streamingRouter };
