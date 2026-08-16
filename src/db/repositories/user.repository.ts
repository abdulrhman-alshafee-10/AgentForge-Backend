import type { User, Prisma } from '@prisma/client';
import { BaseRepository, type TenantContext } from '../base.repository.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CreateUserInput = Omit<Prisma.UserCreateInput, 'tenant'> & {
  tenantId: string;
};

export type UpdateUserInput = Prisma.UserUpdateInput;

// ─── UserRepository ───────────────────────────────────────────────────────────

export class UserRepository extends BaseRepository {
  /** Find by primary key, scoped to the tenant. */
  findById(ctx: TenantContext, id: string): Promise<User | null> {
    const tenantId = this.requireTenant(ctx);
    return this.db.user.findFirst({ where: { id, tenantId } });
  }

  /** Find by email within a tenant (for auth lookups). */
  findByEmail(ctx: TenantContext, email: string): Promise<User | null> {
    const tenantId = this.requireTenant(ctx);
    return this.db.user.findFirst({ where: { tenantId, email } });
  }

  /** List all users for a tenant, newest first. */
  findAll(ctx: TenantContext): Promise<User[]> {
    const tenantId = this.requireTenant(ctx);
    return this.db.user.findMany({
      where:   { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Create a user inside a tenant. */
  create(input: CreateUserInput): Promise<User> {
    const { tenantId, ...rest } = input;
    return this.db.user.create({
      data: {
        ...rest,
        tenant: { connect: { id: tenantId } },
      },
    });
  }

  /** Update a user by ID, scoped to the tenant. */
  async update(
    ctx: TenantContext,
    id: string,
    input: UpdateUserInput,
  ): Promise<User> {
    const tenantId = this.requireTenant(ctx);
    // Verify the user belongs to this tenant before writing
    await this.db.user.findFirstOrThrow({ where: { id, tenantId } });
    return this.db.user.update({ where: { id }, data: input });
  }

  /** Delete a user, scoped to the tenant. */
  async delete(ctx: TenantContext, id: string): Promise<User> {
    const tenantId = this.requireTenant(ctx);
    await this.db.user.findFirstOrThrow({ where: { id, tenantId } });
    return this.db.user.delete({ where: { id } });
  }
}

// Singleton instance
export const userRepository = new UserRepository();
