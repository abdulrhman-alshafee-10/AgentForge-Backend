// ─── Cursor-based pagination ──────────────────────────────────────────────────
import { z } from 'zod';

export const PaginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type PaginationQuery = z.infer<typeof PaginationSchema>;

// ─── Cursor encoding ──────────────────────────────────────────────────────────

export function encodeCursor(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): string {
  return Buffer.from(cursor, 'base64url').toString('utf8');
}

// ─── Response builder ─────────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * Builds a paginated response. Fetch `limit + 1` items; if the extra item
 * exists there is a next page and its cursor is returned.
 */
export function paginate<T>(
  items: T[],
  limit: number,
  getCursorValue: (item: T) => string,
): PaginatedResponse<T> {
  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last !== undefined ? encodeCursor(getCursorValue(last)) : null;
  return { items: page, nextCursor };
}
