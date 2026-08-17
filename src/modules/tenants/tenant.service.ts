// ─── Tenant service ───────────────────────────────────────────────────────────
import { prisma } from '../../db/prisma.js';
import { tenantRepository } from '../../db/repositories/tenant.repository.js';
import { NotFoundError, ConflictError } from '../../common/errors/HttpErrors.js';
import { AppError } from '../../common/errors/AppError.js';
import {
  getCachedTenantSettings,
  setCachedTenantSettings,
  invalidateTenantSettingsCache,
} from '../../common/cache/cache.js';
import type { Tenant } from '@prisma/client';

export interface TenantSettings {
  maxConcurrentExecutions: number;
  maxDocuments: number;
  disabled: boolean;
}

export const DEFAULT_SETTINGS: TenantSettings = {
  maxConcurrentExecutions: 5,
  maxDocuments: 100,
  disabled: false,
};

export function getTenantSettings(tenant: Tenant): TenantSettings {
  return { ...DEFAULT_SETTINGS, ...((tenant.settings ?? {}) as Partial<TenantSettings>) };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getSettings(tenantId: string): Promise<TenantSettings> {
  const cached = await getCachedTenantSettings(tenantId);
  if (cached) return { ...DEFAULT_SETTINGS, ...(cached as Partial<TenantSettings>) };

  const tenant = await tenantRepository.findById(tenantId);
  if (!tenant) throw new NotFoundError('Tenant');

  const settings = getTenantSettings(tenant);
  await setCachedTenantSettings(tenantId, settings as unknown as Record<string, unknown>);
  return settings;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class TenantService {
  async getMyTenant(tenantId: string): Promise<Tenant> {
    const tenant = await tenantRepository.findById(tenantId);
    if (!tenant) throw new NotFoundError('Tenant');
    return tenant;
  }

  async updateMyTenant(tenantId: string, data: { name?: string; settings?: Partial<TenantSettings> }): Promise<Tenant> {
    const tenant = await tenantRepository.findById(tenantId);
    if (!tenant) throw new NotFoundError('Tenant');

    const merged = { ...getTenantSettings(tenant), ...data.settings };
    const result = await tenantRepository.update(tenantId, {
      ...(data.name ? { name: data.name } : {}),
      settings: merged,
    });

    await invalidateTenantSettingsCache(tenantId);
    return result;
  }

  async createTenant(data: { name: string; slug: string; plan?: string }): Promise<Tenant> {
    const existing = await tenantRepository.findBySlug(data.slug);
    if (existing) throw new ConflictError(`Slug "${data.slug}" is already taken`);
    return tenantRepository.create({
      name: data.name,
      slug: data.slug,
      plan: data.plan ?? 'free',
      settings: DEFAULT_SETTINGS as any,
    });
  }

  async disableTenant(tenantId: string): Promise<Tenant> {
    const tenant = await tenantRepository.findById(tenantId);
    if (!tenant) throw new NotFoundError('Tenant');
    const settings = getTenantSettings(tenant);
    if (settings.disabled) throw new ConflictError('Tenant is already disabled');
    const result = await tenantRepository.update(tenantId, { settings: { ...settings, disabled: true } });
    await invalidateTenantSettingsCache(tenantId);
    return result;
  }

  async enableTenant(tenantId: string): Promise<Tenant> {
    const tenant = await tenantRepository.findById(tenantId);
    if (!tenant) throw new NotFoundError('Tenant');
    const settings = getTenantSettings(tenant);
    const result = await tenantRepository.update(tenantId, { settings: { ...settings, disabled: false } });
    await invalidateTenantSettingsCache(tenantId);
    return result;
  }

  async checkExecutionQuota(tenantId: string): Promise<void> {
    const settings = await getSettings(tenantId);
    if (settings.disabled) throw new AppError('This workspace is disabled', 403, 'TENANT_DISABLED');
    if (settings.maxConcurrentExecutions === 0) return;

    const running = await prisma.execution.count({
      where: { tenantId, status: { in: ['RUNNING', 'THINKING', 'WAITING_FOR_USER', 'WAITING_FOR_APPROVAL'] } },
    });
    if (running >= settings.maxConcurrentExecutions) {
      throw new AppError(
        `Concurrent execution limit reached (${settings.maxConcurrentExecutions})`,
        429, 'QUOTA_EXCEEDED',
        { current: running, max: settings.maxConcurrentExecutions },
      );
    }
  }

  async checkDocumentQuota(tenantId: string): Promise<void> {
    const settings = await getSettings(tenantId);
    if (settings.disabled) throw new AppError('This workspace is disabled', 403, 'TENANT_DISABLED');
    if (settings.maxDocuments === 0) return;

    const count = await prisma.document.count({ where: { tenantId } });
    if (count >= settings.maxDocuments) {
      throw new AppError(
        `Document limit reached (${settings.maxDocuments})`,
        429, 'QUOTA_EXCEEDED',
        { current: count, max: settings.maxDocuments },
      );
    }
  }

  async listAll(): Promise<Tenant[]> {
    return tenantRepository.findAll();
  }
}

export const tenantService = new TenantService();
