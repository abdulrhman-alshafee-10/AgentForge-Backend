import { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { validate } from '../../common/middleware/validate.js';
import { authenticate } from '../../common/middleware/authenticate.js';
import { authService } from './auth.service.js';
import { wrap } from '../../common/utils/async-wrap.js';

// ─── Validation schemas ───────────────────────────────────────────────────────

const RegisterSchema = z.object({
  tenantSlug: z.string().min(1),
  email: z.string().email(),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128),
  displayName: z.string().min(1).max(100),
  role: z.enum(['owner', 'member']).optional(),
});

const LoginSchema = z.object({
  tenantSlug: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(1),
});

const RefreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const LogoutSchema = z.object({
  refreshToken: z.string().min(1),
});

// ─── Rate limiters ────────────────────────────────────────────────────────────
//
// Phase 03 uses the in-memory store (default).
// Phase 05 swaps this for a Redis-backed store once Redis is available.

/** 5 attempts per IP per minute */
const loginIpLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many login attempts' } },
});

/** 10 register attempts per IP per 15 minutes */
const registerLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many registration attempts' } },
});

// ─── Router ───────────────────────────────────────────────────────────────────

const router = Router();

/**
 * POST /auth/register
 * Creates a new user in the given tenant and returns a token pair.
 */
router.post(
  '/register',
  registerLimiter,
  validate({ body: RegisterSchema }),
  wrap(async (req: Request, res: Response) => {
    const { user, tokens } = await authService.register(req.body);
    res.status(201).json({ user, ...tokens });
  }),
);

/**
 * POST /auth/login
 * Authenticates a user and returns a token pair.
 */
router.post(
  '/login',
  loginIpLimiter,
  validate({ body: LoginSchema }),
  wrap(async (req: Request, res: Response) => {
    const { user, tokens } = await authService.login({
      ...req.body,
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
    res.json({ user, ...tokens });
  }),
);

/**
 * POST /auth/refresh
 * Rotates the refresh token and returns a new token pair.
 */
router.post(
  '/refresh',
  validate({ body: RefreshSchema }),
  wrap(async (req: Request, res: Response) => {
    const refreshInput: { refreshToken: string; userAgent?: string; ip?: string } = {
      refreshToken: req.body.refreshToken,
    };
    if (req.headers['user-agent']) refreshInput.userAgent = req.headers['user-agent'];
    if (req.ip) refreshInput.ip = req.ip;
    const tokens = await authService.refresh(refreshInput);
    res.json(tokens);
  }),
);

/**
 * POST /auth/logout
 * Revokes the provided refresh token.
 */
router.post(
  '/logout',
  validate({ body: LogoutSchema }),
  wrap(async (req: Request, res: Response) => {
    await authService.logout(req.body.refreshToken);
    res.status(204).send();
  }),
);

/**
 * GET /auth/me
 * Returns the authenticated user's profile.
 * Requires a valid access token.
 */
router.get(
  '/me',
  authenticate(),
  (req: Request, res: Response) => {
    res.json({ user: req.user });
  },
);

export { router as authRouter };
