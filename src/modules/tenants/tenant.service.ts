import { prisma } from '../../db/prisma.js';
import { tenantRepository } from '../../db/repositories/tenant.repository.js';
import { NotFoundError, ConflictError } from '../../common/errors/HttpErrors.js';
import { AppError } from '../../common/errors/AppError.js';
import { getCachedTenantSettings, setCachedTenantSettings, invalidateTenantSettingsCache } from '../../common/cache/cache.js';
import type { Tenant } from '@prisma/client';

// ─── Default quota settings ───────────────────────────────────────────────────
//
// Stored in Tenant.settings and overridable per tenant.

export interface TenantSettings {
  /** Maximum concurrent RUNNING executions (0 = unlimited) */
  maxConcurrentExecutions: number;
  /** Maximum number of indexed documents (0 = unlimited) */
  maxDocuments: number;
  /** Soft-disable flag — blocks new logins and new executions */
  disabled: boolean;
}

export const DEFAULT_SETTINGS: TenantSettings = {
  maxConcurrentExecutions: 5,
  maxDocuments: 100,
  disabled: false,
};

export function getTenantSettings(tenant: Tenant): TenantSettings {
  const s = (tenant.settings ?? {}) as Partial<TenantSettings>;
  return { ...DEFAULT_SETTINGS, ...s };
}

// ─── Tenant Service ───────────────────────────────────────────────────────────

export class TenantService {
  // ─── Get current tenant ─────────────────────────────────────────────────────

  async getMyTenant(tenantId: string): Promise<Tenant> {
    const tenant = await tenantRepository.findById(tenantId);
    if (!tenant) throw new NotFoundError('Tenant');
    return tenant;
  }

  // ─── Update tenant settings ──────────────────────────────────────────────────

  async updateMyTenant(
    tenantId: string,
    data: { name?: string; settings?: Partial<TenantSettings> },
  ): Promise<Tenant> {
    const tenant = await tenantRepository.findById(tenantId);
    if (!tenant) throw new NotFoundError('Tenant');

    const currentSettings = getTenantSettings(tenant);
    const mergedSettings = { ...currentSettings, ...data.settings };

    const result = await tenantRepository.update(tenantId, {
      ...(data.name ? { name: data.name } : {}),
      settings: mergedSettings,
    });

    // Invalidate cached settings so the next request picks up the new values
    await invalidateTenantSettingsCache(tenantId);
    return result;
  }

  // ─── Admin: create tenant ────────────────────────────────────────────────────

  async createTenant(data: {
    name: string;
    slug: string;
    plan?: string;
  }): Promise<Tenant> {
    const existing = await tenantRepository.findBySlug(data.slug);
    if (existing) throw new ConflictError(`Slug "${data.slug}" is already taken`);

    return tenantRepository.create({
      name: data.name,
      slug: data.slug,
      plan: data.plan ?? 'free',
      settings: DEFAULT_SETTINGS as any,
    });
  }

  // ─── Admin: disable tenant ───────────────────────────────────────────────────
  //
  // Soft-disables the tenant: blocks new logins, new executions, and new uploads.
  // Existing running executions are NOT killed — they complete naturally.

  async disableTenant(tenantId: string): Promise<Tenant> {
    const tenant = await tenantRepository.findById(tenantId);
    if (!tenant) throw new NotFoundError('Tenant');

    const settings = getTenantSettings(tenant);
    if (settings.disabled) {
      throw new ConflictError('Tenant is already disabled');
    }

    return tenantRepository.update(tenantId, {
      settings: { ...settings, disabled: true },
    });
  }

  // ─── Admin: re-enable tenant ─────────────────────────────────────────────────

  async enableTenant(tenantId: string): Promise<Tenant> {
    const tenant = await tenantRepository.findById(tenantId);
    if (!tenant) throw new NotFoundError('Tenant');

    const settings = getTenantSettings(tenant);
    return tenantRepository.update(tenantId, {
      settings: { ...settings, disabled: false },
    });
  }

  // ─── Quota: check concurrent executions ─────────────────────────────────────

  async checkExecutionQuota(tenantId: string): Promise<void> {
    // Use cached settings to avoid a DB round-trip on every message send
    let settings: TenantSettings;
    const cached = await getCachedTenantSettings(tenantId);
    if (cached) {
      settings = { ...DEFAULT_SETTINGS, ...(cached as Partial<TenantSettings>) };
    } else {
      const tenant = await tenantRepository.findById(tenantId);
      if (!tenant) throw new NotFoundError('Tenant');
      settings = getTenantSettings(tenant);
      await setCachedTenantSettings(tenantId, settings as unknown as Record<string, unknown>);
    }

    if (settings.disabled) {
      throw new AppError('This workspace is disabled', 403, 'TENANT_DISABLED');
    }

    if (settings.maxConcurrentExecutions === 0) return;

    const running = await prisma.execution.count({
      where: {
        tenantId,
        status: { in: ['RUNNING', 'THINKING', 'WAITING_FOR_USER', 'WAITING_FOR_APPROVAL'] },
      },
    });

    if (running >= settings.maxConcurrentExecutions) {
      throw new AppError(
        `Concurrent execution limit reached (${settings.maxConcurrentExecutions})`,
        429,
        'QUOTA_EXCEEDED',
        { current: running, max: settings.maxConcurrentExecutions },
      );
    }
  }

  async checkDocumentQuota(tenantId: string): Promise<void> {
    let settings: TenantSettings;
    const cached = await getCachedTenantSettings(tenantId);
    if (cached) {
      settings = { ...DEFAULT_SETTINGS, ...(cached as Partial<TenantSettings>) };
    } else {
      const tenant = await tenantRepository.findById(tenantId);
      if (!tenant) throw new NotFoundError('Tenant');
      settings = getTenantSettings(tenant);
      await setCachedTenantSettings(tenantId, settings as unknown as Record<string, unknown>);
    }

    if (settings.disabled) {
      throw new AppError('This workspace is disabled', 403, 'TENANT_DISABLED');
    }

    if (settings.maxDocuments === 0) return;

    const count = await prisma.document.count({ where: { tenantId } });

    if (count >= settings.maxDocuments) {
      throw new AppError(
        `Document limit reached (${settings.maxDocuments})`,
        429,
        'QUOTA_EXCEEDED',
        { current: count, max: settings.maxDocuments },
      );
    }
  }

  // ─── Admin: list all tenants ─────────────────────────────────────────────────

  async listAll(): Promise<Tenant[]> {
    return tenantRepository.findAll();
  }
}

export const tenantService = new TenantService();
