// ─── Execution cancellation service ──────────────────────────────────────────
import { redis } from '../../redis/redis.js';
import { prisma } from '../../db/prisma.js';

const TTL_SECONDS = 3_600;

function cancelKey(tenantId: string, executionId: string): string {
  return `tenant:${tenantId}:cancel:execution:${executionId}`;
}

async function resolveTenantId(executionId: string, tenantId?: string): Promise<string> {
  if (tenantId) return tenantId;
  const exec = await prisma.execution.findUnique({ where: { id: executionId }, select: { tenantId: true } });
  return exec?.tenantId ?? executionId;
}

export const cancellationService = {
  async requestCancel(executionId: string, tenantId?: string): Promise<void> {
    const tid = await resolveTenantId(executionId, tenantId);
    await redis.setex(cancelKey(tid, executionId), TTL_SECONDS, '1');
  },

  async isCancelled(executionId: string, tenantId?: string): Promise<boolean> {
    const tid = await resolveTenantId(executionId, tenantId);
    return (await redis.get(cancelKey(tid, executionId))) === '1';
  },

  async clearCancel(executionId: string, tenantId?: string): Promise<void> {
    const tid = await resolveTenantId(executionId, tenantId);
    await redis.del(cancelKey(tid, executionId));
  },
};
