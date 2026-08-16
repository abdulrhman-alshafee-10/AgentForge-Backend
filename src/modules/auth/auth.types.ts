// ─── Auth types ───────────────────────────────────────────────────────────────
// Phase 03 will populate this file with:
//   AuthUser, TokenPair, JwtPayload, RefreshTokenRecord, ...

export type AuthUser = {
  id: string;
  tenantId: string;
  email: string;
  role: 'owner' | 'member';
};
