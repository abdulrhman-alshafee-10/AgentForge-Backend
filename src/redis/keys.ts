// ─── Redis key namespacing ────────────────────────────────────────────────────
//
// All Redis keys for tenant-scoped data must go through this module so
// there is a single authoritative source of key patterns.
//
// Structure:  tenant:<tenantId>:<resource>:<...>
//
// Cross-cutting keys (e.g. BullMQ internals) are managed by BullMQ itself.

export const redisKeys = {
  /** SSE pub/sub channel for a running execution */
  executionChannel: (tenantId: string, executionId: string) =>
    `tenant:${tenantId}:execution:${executionId}`,

  /** Cancellation flag polled by AgentRunner */
  cancelFlag: (tenantId: string, executionId: string) =>
    `tenant:${tenantId}:cancel:execution:${executionId}`,

  /** Generic rate-limit bucket per user */
  rateLimitBucket: (tenantId: string, userId: string, endpoint: string) =>
    `tenant:${tenantId}:rate:${userId}:${endpoint}`,
};
