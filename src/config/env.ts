import { z } from 'zod';

// ─── Schema ───────────────────────────────────────────────────────────────────

const EnvSchema = z.object({
  // Server
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),

  // CORS: comma-separated list of allowed origins
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((val) => val.split(',').map((s) => s.trim())),

  // Express body size limit
  BODY_LIMIT: z.string().default('1mb'),

  // Graceful shutdown: how long to wait for in-flight requests (ms)
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(0).default(10_000),

  // Database (Phase 02)
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid PostgreSQL URL'),

  // Redis (Phase 05)
  REDIS_URL: z.string().url('REDIS_URL must be a valid Redis URL'),

  // RAG (Phase 06)
  OLLAMA_BASE_URL: z.string().url('OLLAMA_BASE_URL must be a valid URL').default('http://localhost:11434/v1'),
  OLLAMA_API_KEY: z.string().default('ollama'), // Ollama ignores the key but OpenAI SDK requires it
  OLLAMA_EMBED_MODEL: z.string().default('nomic-embed-text'),
  STORAGE_PATH: z.string().default('./storage/documents'),

  // JWT (Phase 03)
  JWT_ACCESS_SECRET: z
    .string()
    .min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z
    .string()
    .min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),
});

export type Env = z.infer<typeof EnvSchema>;

// ─── Loader ───────────────────────────────────────────────────────────────────

function loadEnv(): Env {
  const result = EnvSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    process.stderr.write(
      `\n❌  AgentForge — invalid environment variables:\n${formatted}\n\n`,
    );
    process.exit(1);
  }

  return result.data;
}

// Singleton — parsed once, used everywhere via import.
export const env: Env = loadEnv();
