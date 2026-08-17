import { redis } from '../../redis/redis.js';

// ─── Cancellation Service ─────────────────────────────────────────────────────
//
// Uses a Redis key as a lightweight cancellation flag.
// The HTTP cancel endpoint sets the flag; the worker checks it between
// graph nodes and before each tool call.
//
// Key TTL is set to 1 hour — long enough to survive any plausible execution
// but short enough not to accumulate stale keys.

const TTL_SECONDS = 3_600;

function cancelKey(executionId: string): string {
  return `cancel:execution:${executionId}`;
}

export const cancellationService = {
  /** Signal that the execution should stop as soon as possible. */
  async requestCancel(executionId: string): Promise<void> {
    await redis.setex(cancelKey(executionId), TTL_SECONDS, '1');
  },

  /** Returns true if a cancel has been requested. */
  async isCancelled(executionId: string): Promise<boolean> {
    const val = await redis.get(cancelKey(executionId));
    return val === '1';
  },

  /** Remove the flag once the execution is fully done. */
  async clearCancel(executionId: string): Promise<void> {
    await redis.del(cancelKey(executionId));
  },
};
