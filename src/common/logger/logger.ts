import pino, { type LoggerOptions } from 'pino';
import { env } from '../../config/env.js';

// ─── Pino logger ──────────────────────────────────────────────────────────────
//
// In development we use pino-pretty for human-readable output.
// In production we emit JSON which is consumed by log aggregators.
//
// Note: `exactOptionalPropertyTypes` is enabled in tsconfig, so we build the
// options object conditionally rather than assigning `undefined` to transport.
//
// Usage:
//   import { logger } from './logger.js';
//   logger.info({ executionId }, 'execution started');

const baseOptions: LoggerOptions = {
  level: env.NODE_ENV === 'test' ? 'silent' : 'info',
  base: { service: 'agentforge-api' },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'body.password',
      'body.passwordHash',
      'body.token',
      'body.refreshToken',
    ],
    remove: true,
  },
};

// Only add `transport` in development — avoids the undefined type conflict
// that exactOptionalPropertyTypes would raise if we used a ternary inline.
const options: LoggerOptions =
  env.NODE_ENV === 'development'
    ? {
        ...baseOptions,
        transport: {
          target: 'pino-pretty',
          options: { colorize: true },
        },
      }
    : baseOptions;

export const logger = pino(options);
