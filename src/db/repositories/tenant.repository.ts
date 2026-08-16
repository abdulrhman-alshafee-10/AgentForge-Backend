// eslint-disable-next-line @typescript-eslint/no-require-imports
import { BaseRepository } from '../base.repository.js';

// ─── Types ────────────────────────────────────────────────────────────────────
// These are re-exported from @prisma/client after `prisma generate` runs.
// Using `import type` keeps the build clean even before generation.

import type { Tenant, Prisma } from '@prisma/client';

export type CreateTenantInput = Prisma.TenantCreateInput;
export type UpdateTenantInput = Prisma.TenantUpdateInput;

// ─── TenantRepository ─────────────────────────────────────────────────────────
//
// Tenant is the root entity — queries are NOT scoped by tenantId
// (the row IS the tenant). All other repositories scope by tenantId.

export class TenantRepository extends BaseRepository {
  /** Find by primary key. */
  findById(id: string): Promise<Tenant | null> {
    return this.db.tenant.findUnique({ where: { id } });
  }

  /** Find by URL-safe slug. */
  findBySlug(slug: string): Promise<Tenant | null> {
    return this.db.tenant.findUnique({ where: { slug } });
  }

  /** List all tenants (admin use only). */
  findAll(): Promise<Tenant[]> {
    return this.db.tenant.findMany({ orderBy: { createdAt: 'asc' } });
  }

  /** Create a new tenant. */
  create(input: CreateTenantInput): Promise<Tenant> {
    return this.db.tenant.create({ data: input });
  }

  /** Update a tenant by ID. */
  update(id: string, input: UpdateTenantInput): Promise<Tenant> {
    return this.db.tenant.update({ where: { id }, data: input });
  }

  /** Delete a tenant (guarded by explicit admin flow). */
  delete(id: string): Promise<Tenant> {
    return this.db.tenant.delete({ where: { id } });
  }
}

// Singleton instance
export const tenantRepository = new TenantRepository();
