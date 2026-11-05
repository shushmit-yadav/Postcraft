import { z } from 'zod';

/**
 * All configuration comes from environment variables and is validated at boot,
 * so a misconfigured process fails fast with a clear message instead of
 * misbehaving later.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1),
  APP_SECRET: z.string().min(32, 'APP_SECRET must be at least 32 characters'),
  STORAGE_DIR: z.string().default('./data/storage'),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  /** Directory with the built SPA. When set, the API also serves the UI (same origin). */
  WEB_DIST_DIR: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional().transform((v) => (v ? v : undefined)),
  ANTHROPIC_MODEL: z.string().default('claude-opus-5-5'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Config = z.infer<typeof EnvSchema>;

function loadConfig(): Config {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    console.error(`Invalid environment configuration:\n${issues.join('\n')}`);
    console.error('Copy .env.example to .env and fill in the values.');
    process.exit(1);
  }
  return parsed.data;
}

export const config = loadConfig();
export const isProd = config.NODE_ENV === 'production';
