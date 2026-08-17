// ─── Base repository ──────────────────────────────────────────────────────────
import type { PrismaClient } from '@prisma/client';
import { prisma } from './prisma.js';

export interface TenantContext {
  tenantId: string;
}

export abstract class BaseRepository {
  protected readonly db: PrismaClient;

  constructor(db: PrismaClient = prisma) {
    this.db = db;
  }

  /** Asserts tenantId is present. Throws in dev; logs in prod (RLS is the hard guard). */
  protected requireTenant(ctx: TenantContext): string {
    if (!ctx.tenantId) {
      const msg = 'Repository called without tenantId — possible data leak';
      if (process.env.NODE_ENV !== 'production') throw new Error(msg);
      console.error(msg);
    }
    return ctx.tenantId;
  }
}
