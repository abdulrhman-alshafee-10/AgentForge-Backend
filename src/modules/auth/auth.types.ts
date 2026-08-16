// ─── Auth types ───────────────────────────────────────────────────────────────

export type UserRole = 'owner' | 'member';

/** Subset of User attached to Request after authentication. */
export type AuthUser = {
  id: string;
  tenantId: string;
  email: string;
  role: UserRole;
};

/** Claims embedded in the JWT access token. */
export type JwtPayload = {
  sub: string;       // userId
  tenantId: string;
  email: string;
  role: UserRole;
};

/** Pair returned on login / refresh. */
export type TokenPair = {
  accessToken: string;
  refreshToken: string;
};

/** Shape of a refresh token row (sans user relation). */
export type RefreshTokenRecord = {
  id: string;
  userId: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  userAgent: string | null;
  ipHash: string | null;
  createdAt: Date;
};
