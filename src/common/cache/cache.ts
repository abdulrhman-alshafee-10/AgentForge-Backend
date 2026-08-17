import { createHash } from 'crypto';
import { redis } from '../../redis/redis.js';
import { env } from '../../config/env.js';
import { logger } from '../logger/logger.js';

// ─── Generic Redis cache ──────────────────────────────────────────────────────
//
// A thin get/set wrapper with optional TTL and namespace.
// Values are JSON-serialised before storage.

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  try {
    await redis.setex(key, ttlSeconds, JSON.stringify(value));
  } catch (err) {
    logger.warn({ err, key }, 'Cache write failed — continuing without cache');
  }
}

export async function cacheDel(key: string): Promise<void> {
  try {
    await redis.del(key);
  } catch {
    // non-fatal
  }
}

// ─── Embedding content-hash cache ────────────────────────────────────────────
//
// Embeddings are deterministic for a given (model, content) pair.
// Cache them by SHA-256(model + content) to avoid repeated Ollama round-trips.

function embeddingCacheKey(model: string, content: string): string {
  const hash = createHash('sha256').update(`${model}:${content}`).digest('hex');
  return `cache:embed:${hash}`;
}

export async function getCachedEmbedding(model: string, content: string): Promise<number[] | null> {
  if (env.CACHE_EMBEDDING_TTL === 0) return null;
  return cacheGet<number[]>(embeddingCacheKey(model, content));
}

export async function setCachedEmbedding(model: string, content: string, vector: number[]): Promise<void> {
  if (env.CACHE_EMBEDDING_TTL === 0) return;
  await cacheSet(embeddingCacheKey(model, content), vector, env.CACHE_EMBEDDING_TTL);
}

// ─── Tenant settings cache ────────────────────────────────────────────────────
//
// Tenant settings are read on every message send and document upload.
// Cache them for a short TTL to reduce DB load.

function tenantSettingsCacheKey(tenantId: string): string {
  return `cache:tenant:${tenantId}:settings`;
}

export async function getCachedTenantSettings(tenantId: string): Promise<Record<string, unknown> | null> {
  if (env.CACHE_TENANT_SETTINGS_TTL === 0) return null;
  return cacheGet<Record<string, unknown>>(tenantSettingsCacheKey(tenantId));
}

export async function setCachedTenantSettings(tenantId: string, settings: Record<string, unknown>): Promise<void> {
  if (env.CACHE_TENANT_SETTINGS_TTL === 0) return;
  await cacheSet(tenantSettingsCacheKey(tenantId), settings, env.CACHE_TENANT_SETTINGS_TTL);
}

export async function invalidateTenantSettingsCache(tenantId: string): Promise<void> {
  await cacheDel(tenantSettingsCacheKey(tenantId));
}
