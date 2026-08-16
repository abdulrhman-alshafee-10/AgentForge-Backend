import jwt, { type SignOptions } from 'jsonwebtoken';
import { createHash, randomBytes } from 'crypto';
import { env } from '../../config/env.js';
import type { JwtPayload, AuthUser } from './auth.types.js';

// ─── TokenService ─────────────────────────────────────────────────────────────
//
// Signs and verifies HS256 JWTs for access and refresh flows.
// Refresh tokens are opaque random strings — only their SHA-256 hash is stored
// in the DB, so a compromised DB dump cannot be used to hijack sessions.

export class TokenService {
  // ── Access token ────────────────────────────────────────────────────────

  signAccessToken(user: AuthUser): string {
    const payload: JwtPayload = {
      sub: user.id,
      tenantId: user.tenantId,
      email: user.email,
      role: user.role,
    };

    const options: SignOptions = { algorithm: 'HS256' };
    // JWT_ACCESS_EXPIRES_IN is always a non-empty string per env schema default
    if (env.JWT_ACCESS_EXPIRES_IN) {
      (options as Record<string, unknown>)['expiresIn'] = env.JWT_ACCESS_EXPIRES_IN;
    }

    return jwt.sign(payload, env.JWT_ACCESS_SECRET, options);
  }

  verifyAccessToken(token: string): JwtPayload {
    return jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload;
  }

  // ── Refresh token ────────────────────────────────────────────────────────

  /**
   * Returns a cryptographically random opaque token string.
   * Callers must store only `hashRefreshToken(token)` in the DB.
   */
  generateRefreshToken(): string {
    // 48 random bytes → 96-char hex string
    return randomBytes(48).toString('hex');
  }

  /** SHA-256 hex digest of the raw refresh token. */
  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** Compute expiry Date from the configured duration string (e.g. "30d"). */
  refreshTokenExpiresAt(): Date {
    const raw = env.JWT_REFRESH_EXPIRES_IN; // e.g. "30d", "7d", "1d"
    const match = /^(\d+)([smhd])$/.exec(raw);
    if (!match) throw new Error(`Invalid JWT_REFRESH_EXPIRES_IN: "${raw}"`);

    const amount = parseInt(match[1]!, 10);
    const unit = match[2]!;

    const multipliers: Record<string, number> = {
      s: 1_000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
    };

    return new Date(Date.now() + amount * multipliers[unit]!);
  }
}

export const tokenService = new TokenService();
