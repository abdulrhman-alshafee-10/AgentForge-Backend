import { prisma } from '../../db/prisma.js';
import { redis } from '../../redis/redis.js';
import { paginate, decodeCursor } from '../../common/utils/pagination.js';
import type { Prisma, Event } from '@prisma/client';

export class EventsService {
  /**
   * Appends a new event to the Execution's event stream.
   * Calculates the next sequence atomically per execution, persists to Postgres,
   * then publishes to the Redis pub/sub channel.
   */
  async appendEvent(
    tenantId: string,
    chatId: string,
    executionId: string,
    type: string,
    payload: any,
  ): Promise<Event> {
    const event = await prisma.$transaction(async (tx) => {
      // Find the current max sequence for this execution
      const maxSeq = await tx.event.aggregate({
        where: { executionId },
        _max: { sequence: true },
      });
      const nextSequence = (maxSeq._max.sequence || 0) + 1;

      // Create the event
      return tx.event.create({
        data: {
          tenantId,
          chatId,
          executionId,
          sequence: nextSequence,
          type,
          payload: payload || {},
        },
      });
    });

    // Publish to Redis
    const channel = `execution:${executionId}`;
    await redis.publish(channel, JSON.stringify(event));

    return event;
  }

  /**
   * Retrieves events for an execution, useful for cold reconstruction
   * and fetching missed events since a specific sequence.
   */
  async getEvents(
    executionId: string,
    limit: number,
    cursor?: string,
    afterSequence?: number,
  ) {
    const decodedCursor = cursor ? decodeCursor(cursor) : undefined;
    
    const where: Prisma.EventWhereInput = { executionId };
    
    if (afterSequence !== undefined) {
      where.sequence = { gt: afterSequence };
    }

    const items = await prisma.event.findMany({
      where,
      take: limit + 1,
      ...(decodedCursor && {
        cursor: { id: decodedCursor },
        skip: 1,
      }),
      orderBy: { sequence: 'asc' },
    });

    return paginate(items, limit, (event) => event.id);
  }
}

export const eventsService = new EventsService();
