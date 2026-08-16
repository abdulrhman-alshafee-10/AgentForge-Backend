import type { RefreshToken } from '@prisma/client';
import { BaseRepository } from '../base.repository.js';

// ─── RefreshTokenRepository ───────────────────────────────────────────────────

export class RefreshTokenRepository extends BaseRepository {
  /** Look up a refresh token by its hash. */
  findByHash(tokenHash: string): Promise<RefreshToken | null> {
    return this.db.refreshToken.findUnique({ where: { tokenHash } });
  }

  /** Create a new refresh token record. */
  create(input: {
    userId: string;
    tokenHash: string;
    familyId: string;
    expiresAt: Date;
    userAgent?: string;
    ipHash?: string;
  }): Promise<RefreshToken> {
    return this.db.refreshToken.create({ data: input });
  }

  /**
   * Soft-revoke a single token by ID.
   * Returns null if the token doesn't exist.
   */
  async revoke(id: string): Promise<RefreshToken | null> {
    try {
      return await this.db.refreshToken.update({
        where: { id },
        data: { revokedAt: new Date() },
      });
    } catch {
      return null;
    }
  }

  /**
   * Revoke all tokens in a family (reuse detection).
   * Call this when a revoked token is presented — it invalidates the whole
   * family so any sibling tokens from the same login chain also become invalid.
   */
  revokeFamily(familyId: string): Promise<{ count: number }> {
    return this.db.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Revoke all active tokens for a user (logout-all / force re-login). */
  revokeAllForUser(userId: string): Promise<{ count: number }> {
    return this.db.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

export const refreshTokenRepository = new RefreshTokenRepository();
