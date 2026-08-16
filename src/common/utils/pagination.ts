import { z } from 'zod';

// ─── Pagination ────────────────────────────────────────────────────────────────
//
// AgentForge uses cursor-based pagination everywhere.
// The cursor is an opaque base64-encoded string (wraps a row ID or timestamp).
// Consumers use the Zod schema to validate query params and the helpers to
// encode/decode cursors and build responses.

// ── Schema ─────────────────────────────────────────────────────────────────────

export const PaginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type PaginationQuery = z.infer<typeof PaginationSchema>;

// ── Cursor helpers ─────────────────────────────────────────────────────────────

export function encodeCursor(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): string {
  return Buffer.from(cursor, 'base64url').toString('utf8');
}

// ── Response builder ───────────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * Build a paginated response.
 *
 * @param items   - The items fetched (fetch limit + 1 to detect a next page).
 * @param limit   - The requested page size.
 * @param getCursorValue - Extract the cursor string from the last item.
 */
export function paginate<T>(
  items: T[],
  limit: number,
  getCursorValue: (item: T) => string,
): PaginatedResponse<T> {
  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  const lastItem = page[page.length - 1];
  const nextCursor =
    hasMore && lastItem !== undefined
      ? encodeCursor(getCursorValue(lastItem))
      : null;

  return { items: page, nextCursor };
}
