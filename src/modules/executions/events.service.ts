// ─── Execution events service ─────────────────────────────────────────────────
import { prisma } from '../../db/prisma.js';
import { redis } from '../../redis/redis.js';
import { paginate, decodeCursor } from '../../common/utils/pagination.js';
import type { Prisma, Event } from '@prisma/client';

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
   * Atomically assigns the next sequence number, persists the event, then
   * publishes to the tenant-namespaced Redis channel.
   * `_chatId` is accepted for call-site compat but is not stored.
   */
  async appendEvent(
    tenantId: string,
    _chatId: string,
    executionId: string,
    type: string,
    payload?: Record<string, unknown>,
  ): Promise<EventDto> {
    const event = await prisma.$transaction(async (tx) => {
      const maxSeq = await tx.event.aggregate({ where: { executionId }, _max: { sequence: true } });
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
    const channel = `tenant:${tenantId}:execution:${executionId}`;
    redis.publish(channel, JSON.stringify(dto)).catch(() => {});

    return dto;
  }

  /** Returns paginated events for an execution, optionally after a given sequence. */
  async getEvents(
    executionId: string,
    limit: number,
    cursor?: string,
    afterSequence?: number,
  ): Promise<{ items: EventDto[]; nextCursor: string | null }> {
    const decodedCursor = cursor ? decodeCursor(cursor) : undefined;
    const where: Prisma.EventWhereInput = {
      executionId,
      ...(afterSequence !== undefined && afterSequence > 0 ? { sequence: { gt: afterSequence } } : {}),
    };
    const raw = await prisma.event.findMany({
      where,
      take: limit + 1,
      ...(decodedCursor && { cursor: { id: decodedCursor }, skip: 1 }),
      orderBy: { sequence: 'asc' },
    });
    return paginate(raw.map(toDto), limit, (e) => e.id);
  }
}

export const eventsService = new EventsService();
