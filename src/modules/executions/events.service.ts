import { prisma } from '../../db/prisma.js';
import { redis } from '../../redis/redis.js';
import { paginate, encodeCursor, decodeCursor } from '../../common/utils/pagination.js';
import type { Prisma, Event } from '@prisma/client';

// ─── Serialisable event shape ──────────────────────────────────────────────────
// BigInt does not serialise to JSON natively; we convert sequence to number
// (safe: sequence will never exceed Number.MAX_SAFE_INTEGER in practice).

export interface EventDto {
  id: string;
  tenantId: string;
  executionId: string;
  sequence: number;
  type: string;
  payload: Prisma.JsonValue;
  createdAt: Date;
}

function toDto(event: Event): EventDto {
  return { ...event, sequence: Number(event.sequence) };
}

export class EventsService {
  /**
   * Appends a new event to the Execution's event stream.
   *
   * The next sequence is computed atomically inside a transaction using
   * MAX(sequence)+1 with a row-level lock on all current rows for the execution.
   * After commit, the event is published to the Redis pub/sub channel so live
   * subscribers receive it immediately.
   */
  async appendEvent(
    tenantId: string,
    chatId: string,
    executionId: string,
    type: string,
    payload?: Record<string, unknown>,
  ): Promise<EventDto> {
    const event = await prisma.$transaction(async (tx) => {
      const maxSeq = await tx.event.aggregate({
        where: { executionId },
        _max: { sequence: true },
      });
      const nextSequence = Number(maxSeq._max.sequence ?? 0) + 1;

      return tx.event.create({
        data: {
          tenantId,
          executionId,
          sequence: nextSequence,
          type,
          payload: (payload ?? {}) as Prisma.InputJsonValue,
        },
      });
    });

    const dto = toDto(event);

    // Publish to Redis — failure is non-fatal; events are already in Postgres
    // and can be replayed from there by reconnecting clients.
    const channel = `execution:${executionId}`;
    redis.publish(channel, JSON.stringify(dto)).catch(() => {
      // intentionally swallowed — Postgres is the source of truth
    });

    return dto;
  }

  /**
   * Retrieves events for an execution in ascending sequence order.
   *
   * @param executionId  - The execution to query.
   * @param limit        - Maximum number of items to return.
   * @param cursor       - Opaque pagination cursor (encodes a row ID).
   * @param afterSequence - When set, only return events with sequence > this value.
   *                        Used by the SSE handler to replay missed events.
   */
  async getEvents(
    executionId: string,
    limit: number,
    cursor?: string,
    afterSequence?: number,
  ): Promise<{ items: EventDto[]; nextCursor: string | null }> {
    const decodedCursor = cursor ? decodeCursor(cursor) : undefined;

    const where: Prisma.EventWhereInput = {
      executionId,
      ...(afterSequence !== undefined && afterSequence > 0
        ? { sequence: { gt: afterSequence } }
        : {}),
    };

    const raw = await prisma.event.findMany({
      where,
      take: limit + 1,
      ...(decodedCursor && { cursor: { id: decodedCursor }, skip: 1 }),
      orderBy: { sequence: 'asc' },
    });

    const dtos = raw.map(toDto);
    return paginate(dtos, limit, (e) => e.id);
  }
}

export const eventsService = new EventsService();

