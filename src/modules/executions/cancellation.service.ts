import { redis } from '../../redis/redis.js';
import { prisma } from '../../db/prisma.js';

// ─── Cancellation Service ─────────────────────────────────────────────────────
//
// Uses a tenant-namespaced Redis key as a lightweight cancellation flag.
// The HTTP cancel endpoint sets the flag; the worker polls it between nodes.
//
// Key TTL: 1 hour — survives any plausible execution duration.

const TTL_SECONDS = 3_600;

function cancelKey(tenantId: string, executionId: string): string {
  return `tenant:${tenantId}:cancel:execution:${executionId}`;
}

// ─── Helper: resolve tenantId from executionId if not provided ────────────────

async function resolveTenantId(executionId: string, tenantId?: string): Promise<string> {
  if (tenantId) return tenantId;
  const exec = await prisma.execution.findUnique({
    where: { id: executionId },
    select: { tenantId: true },
  });
  return exec?.tenantId ?? executionId; // fallback to executionId avoids crashes
}

export const cancellationService = {
  /** Signal that the execution should stop as soon as possible. */
  async requestCancel(executionId: string, tenantId?: string): Promise<void> {
    const tid = await resolveTenantId(executionId, tenantId);
    await redis.setex(cancelKey(tid, executionId), TTL_SECONDS, '1');
  },

  /** Returns true if a cancel has been requested. */
  async isCancelled(executionId: string, tenantId?: string): Promise<boolean> {
    const tid = await resolveTenantId(executionId, tenantId);
    const val = await redis.get(cancelKey(tid, executionId));
    return val === '1';
  },

  /** Remove the flag once the execution is fully done. */
  async clearCancel(executionId: string, tenantId?: string): Promise<void> {
    const tid = await resolveTenantId(executionId, tenantId);
    await redis.del(cancelKey(tid, executionId));
  },
};
