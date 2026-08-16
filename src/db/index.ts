// ─── DB barrel ───────────────────────────────────────────────────────────────
// Re-export the Prisma client and the repository layer from a single entry point.

export { prisma } from './prisma.js';
export { BaseRepository, type TenantContext } from './base.repository.js';
export { TenantRepository, tenantRepository } from './repositories/tenant.repository.js';
export { UserRepository, userRepository } from './repositories/user.repository.js';
