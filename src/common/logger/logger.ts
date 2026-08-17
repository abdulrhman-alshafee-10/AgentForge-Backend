// ─── Structured logger ────────────────────────────────────────────────────────
import pino, { type LoggerOptions } from 'pino';
import { env } from '../../config/env.js';

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

const options: LoggerOptions =
  env.NODE_ENV === 'development'
    ? { ...baseOptions, transport: { target: 'pino-pretty', options: { colorize: true } } }
    : baseOptions;

export const logger = pino(options);
