// ─── Redis key namespacing ────────────────────────────────────────────────────
// All tenant-scoped keys follow: tenant:<tenantId>:<resource>:<...>

export const redisKeys = {
  executionChannel: (tenantId: string, executionId: string) =>
    `tenant:${tenantId}:execution:${executionId}`,

  cancelFlag: (tenantId: string, executionId: string) =>
    `tenant:${tenantId}:cancel:execution:${executionId}`,

  rateLimitBucket: (tenantId: string, userId: string, endpoint: string) =>
    `tenant:${tenantId}:rate:${userId}:${endpoint}`,
};
