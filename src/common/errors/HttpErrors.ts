import { AppError } from './AppError.js';

// ─── 400 Validation Error ─────────────────────────────────────────────────────
export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details?: unknown) {
    super(message, 400, 'VALIDATION_ERROR', details);
  }
}

// ─── 401 Unauthenticated ──────────────────────────────────────────────────────
export class UnauthenticatedError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'UNAUTHENTICATED');
  }
}

// ─── 403 Forbidden ───────────────────────────────────────────────────────────
export class ForbiddenError extends AppError {
  constructor(message = 'Access denied') {
    super(message, 403, 'FORBIDDEN');
  }
}

// ─── 404 Not Found ────────────────────────────────────────────────────────────
export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
  }
}

// ─── 409 Conflict ────────────────────────────────────────────────────────────
export class ConflictError extends AppError {
  constructor(message = 'Conflict') {
    super(message, 409, 'CONFLICT');
  }
}

// ─── 422 Semantic Error ───────────────────────────────────────────────────────
export class SemanticError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 422, 'SEMANTIC_ERROR', details);
  }
}

// ─── 429 Rate Limited ────────────────────────────────────────────────────────
export class RateLimitedError extends AppError {
  constructor(message = 'Too many requests') {
    super(message, 429, 'RATE_LIMITED');
  }
}
