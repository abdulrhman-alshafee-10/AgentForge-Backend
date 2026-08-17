// ─── Redis cache helpers ──────────────────────────────────────────────────────
import { createHash } from 'crypto';
import { redis } from '../../redis/redis.js';
import { env } from '../../config/env.js';
import { logger } from '../logger/logger.js';

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await redis.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  try {
    await redis.setex(key, ttlSeconds, JSON.stringify(value));
  } catch (err) {
    logger.warn({ err, key }, 'Cache write failed');
  }
}

export async function cacheDel(key: string): Promise<void> {
  try {
    await redis.del(key);
  } catch { /* non-fatal */ }
}

// ─── Embedding cache (keyed by SHA-256 of model+content) ─────────────────────

function embeddingKey(model: string, content: string): string {
  const hash = createHash('sha256').update(`${model}:${content}`).digest('hex');
  return `cache:embed:${hash}`;
}

export async function getCachedEmbedding(model: string, content: string): Promise<number[] | null> {
  if (env.CACHE_EMBEDDING_TTL === 0) return null;
  return cacheGet<number[]>(embeddingKey(model, content));
}

export async function setCachedEmbedding(model: string, content: string, vector: number[]): Promise<void> {
  if (env.CACHE_EMBEDDING_TTL === 0) return;
  await cacheSet(embeddingKey(model, content), vector, env.CACHE_EMBEDDING_TTL);
}

// ─── Tenant settings cache ────────────────────────────────────────────────────

function tenantSettingsKey(tenantId: string): string {
  return `cache:tenant:${tenantId}:settings`;
}

export async function getCachedTenantSettings(tenantId: string): Promise<Record<string, unknown> | null> {
  if (env.CACHE_TENANT_SETTINGS_TTL === 0) return null;
  return cacheGet<Record<string, unknown>>(tenantSettingsKey(tenantId));
}

export async function setCachedTenantSettings(tenantId: string, settings: Record<string, unknown>): Promise<void> {
  if (env.CACHE_TENANT_SETTINGS_TTL === 0) return;
  await cacheSet(tenantSettingsKey(tenantId), settings, env.CACHE_TENANT_SETTINGS_TTL);
}

export async function invalidateTenantSettingsCache(tenantId: string): Promise<void> {
  await cacheDel(tenantSettingsKey(tenantId));
}
