import type { PrismaClient } from '@prisma/client';
import { prisma } from './prisma.js';

// ─── TenantContext ────────────────────────────────────────────────────────────
//
// Passed explicitly into every repository call so queries are always scoped.
// Later phases populate this from the JWT via middleware.

export interface TenantContext {
  tenantId: string;
}

// ─── BaseRepository ───────────────────────────────────────────────────────────
//
// Thin base class that gives every repository:
//   - a reference to the Prisma client
//   - a guard that throws if tenantId is missing in development

export abstract class BaseRepository {
  protected readonly db: PrismaClient;

  constructor(db: PrismaClient = prisma) {
    this.db = db;
  }

  /**
   * Assert a TenantContext is present.
   * Throws in development so bugs are caught early; logs a warning in
   * production (fail-open is intentional here — RLS is the hard guard).
   */
  protected requireTenant(ctx: TenantContext): string {
    if (!ctx.tenantId) {
      const msg = 'Repository called without tenantId — possible data leak';
      if (process.env.NODE_ENV !== 'production') {
        throw new Error(msg);
      }
      // In production, surface via logging and let RLS catch it
      console.error(msg);
    }
    return ctx.tenantId;
  }
}
