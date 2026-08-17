import { createHash, randomUUID } from 'crypto';
import { ConflictError, NotFoundError, UnauthenticatedError } from '../../common/errors/index.js';
import { AppError } from '../../common/errors/AppError.js';
import { userRepository } from '../../db/repositories/user.repository.js';
import { refreshTokenRepository } from '../../db/repositories/refresh-token.repository.js';
import { tenantRepository } from '../../db/repositories/tenant.repository.js';
import { passwordService } from './password.service.js';
import { tokenService } from './token.service.js';
import { getTenantSettings } from '../tenants/tenant.service.js';
import type { AuthUser, TokenPair } from './auth.types.js';

// ─── AuthService ──────────────────────────────────────────────────────────────

export class AuthService {
  // ── Register ──────────────────────────────────────────────────────────────

  async register(input: {
    tenantSlug: string;
    email: string;
    password: string;
    displayName: string;
    role?: 'owner' | 'member';
  }): Promise<{ user: AuthUser; tokens: TokenPair }> {
    // 1. Resolve tenant
    const tenant = await tenantRepository.findBySlug(input.tenantSlug);
    if (!tenant) throw new NotFoundError('Tenant');

    const ctx = { tenantId: tenant.id };

    // 2. Check email uniqueness within tenant
    const existing = await userRepository.findByEmail(ctx, input.email);
    if (existing) throw new ConflictError('Email already registered');

    // 3. Hash password
    const passwordHash = await passwordService.hash(input.password);

    // 4. Create user
    const user = await userRepository.create({
      tenantId: tenant.id,
      email: input.email,
      passwordHash,
      displayName: input.displayName,
      role: input.role ?? 'member',
    });

    const authUser: AuthUser = {
      id: user.id,
      tenantId: user.tenantId,
      email: user.email,
      role: user.role as AuthUser['role'],
    };

    // 5. Issue tokens
    const tokens = await this._issueTokenPair(authUser);

    return { user: authUser, tokens };
  }

  // ── Login ─────────────────────────────────────────────────────────────────

  async login(input: {
    tenantSlug: string;
    email: string;
    password: string;
    userAgent?: string;
    ip?: string;
  }): Promise<{ user: AuthUser; tokens: TokenPair }> {
    // 1. Resolve tenant
    const tenant = await tenantRepository.findBySlug(input.tenantSlug);
    if (!tenant) throw new UnauthenticatedError('Invalid credentials');

    // 1a. Check tenant is not disabled
    const settings = getTenantSettings(tenant);
    if (settings.disabled) {
      throw new AppError('This workspace is disabled', 403, 'TENANT_DISABLED');
    }

    const ctx = { tenantId: tenant.id };

    // 2. Find user — use a generic error to avoid user enumeration
    const user = await userRepository.findByEmail(ctx, input.email);
    if (!user) throw new UnauthenticatedError('Invalid credentials');

    // 3. Verify password
    const valid = await passwordService.verify(user.passwordHash, input.password);
    if (!valid) throw new UnauthenticatedError('Invalid credentials');

    const authUser: AuthUser = {
      id: user.id,
      tenantId: user.tenantId,
      email: user.email,
      role: user.role as AuthUser['role'],
    };

    // 4. Issue tokens
    const loginMeta: { userAgent?: string; ip?: string } = {};
    if (input.userAgent) loginMeta.userAgent = input.userAgent;
    if (input.ip) loginMeta.ip = input.ip;
    const tokens = await this._issueTokenPair(authUser, loginMeta);

    return { user: authUser, tokens };
  }

  // ── Refresh ───────────────────────────────────────────────────────────────

  async refresh(input: {
    refreshToken: string;
    userAgent?: string;
    ip?: string;
  }): Promise<TokenPair> {
    const tokenHash = tokenService.hashRefreshToken(input.refreshToken);
    const stored = await refreshTokenRepository.findByHash(tokenHash);

    if (!stored) throw new UnauthenticatedError('Invalid refresh token');

    // Reuse detection: token was already revoked
    if (stored.revokedAt) {
      // Revoke the entire family — attacker may have the new token
      await refreshTokenRepository.revokeFamily(stored.familyId);
      throw new UnauthenticatedError('Refresh token reuse detected — please log in again');
    }

    // Expired
    if (stored.expiresAt < new Date()) {
      await refreshTokenRepository.revoke(stored.id);
      throw new UnauthenticatedError('Refresh token expired');
    }

    // 1. Rotate: revoke the used token
    await refreshTokenRepository.revoke(stored.id);

    // 2. Fetch the user to build AuthUser
    const user = await userRepository.findByIdUnsafe(stored.userId);

    if (!user) throw new UnauthenticatedError('User not found');

    const authUser: AuthUser = {
      id: user.id,
      tenantId: user.tenantId,
      email: user.email,
      role: user.role as AuthUser['role'],
    };

    // 3. Issue a new pair, reusing the same familyId
    const newRaw = tokenService.generateRefreshToken();
    const newHash = tokenService.hashRefreshToken(newRaw);

    const createInput: {
      userId: string;
      tokenHash: string;
      familyId: string;
      expiresAt: Date;
      userAgent?: string;
      ipHash?: string;
    } = {
      userId: user.id,
      tokenHash: newHash,
      familyId: stored.familyId,
      expiresAt: tokenService.refreshTokenExpiresAt(),
    };

    const resolvedUserAgent = input.userAgent ?? stored.userAgent ?? undefined;
    const resolvedIpHash = input.ip
      ? createHash('sha256').update(input.ip).digest('hex')
      : stored.ipHash ?? undefined;

    if (resolvedUserAgent) createInput.userAgent = resolvedUserAgent;
    if (resolvedIpHash) createInput.ipHash = resolvedIpHash;

    await refreshTokenRepository.create(createInput);

    return {
      accessToken: tokenService.signAccessToken(authUser),
      refreshToken: newRaw,
    };
  }

  // ── Logout ────────────────────────────────────────────────────────────────

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = tokenService.hashRefreshToken(refreshToken);
    const stored = await refreshTokenRepository.findByHash(tokenHash);
    if (stored && !stored.revokedAt) {
      await refreshTokenRepository.revoke(stored.id);
    }
  }

  // ── Logout all sessions ────────────────────────────────────────────────────

  async logoutAll(userId: string): Promise<void> {
    await refreshTokenRepository.revokeAllForUser(userId);
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private async _issueTokenPair(
    user: AuthUser,
    meta?: { userAgent?: string; ip?: string },
  ): Promise<TokenPair> {
    const raw = tokenService.generateRefreshToken();
    const hash = tokenService.hashRefreshToken(raw);
    const familyId = randomUUID();

    const createInput: {
      userId: string;
      tokenHash: string;
      familyId: string;
      expiresAt: Date;
      userAgent?: string;
      ipHash?: string;
    } = {
      userId: user.id,
      tokenHash: hash,
      familyId,
      expiresAt: tokenService.refreshTokenExpiresAt(),
    };

    if (meta?.userAgent) createInput.userAgent = meta.userAgent;
    if (meta?.ip) createInput.ipHash = createHash('sha256').update(meta.ip).digest('hex');

    await refreshTokenRepository.create(createInput);

    return {
      accessToken: tokenService.signAccessToken(user),
      refreshToken: raw,
    };
  }
}

export const authService = new AuthService();
