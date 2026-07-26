// env.schema.ts — validates process.env once at boot (wired via ConfigModule.forRoot({validate})).
// Fails fast with every problem listed at once, instead of the app limping along on an
// undefined/empty var until the code path that reads it happens to run.
// Zod, not class-validator: this validates a plain env-var map, not an incoming DTO —
// class-validator needs a decorated class instance, Zod just needs a schema. Locked in system.md.

import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),

  // Core infra — nothing works without these.
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(8, 'JWT_SECRET must be at least 8 characters'),
  // CHANNEL_ENCRYPTION_KEY is intentionally not validated here — it stays lazily
  // checked in credential-cipher.ts (throws on first encrypt/decrypt call).

  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),

  FRONTEND_URL: z.string().url().default('http://localhost:3000'),
  AI_SERVICE_URL: z.string().url().default('http://localhost:8000'),

  // Per-channel provider credentials — genuinely optional: the email adapter already
  // no-ops with a warning log when these are absent. Not every deployment configures
  // every channel. WhatsApp (Meta) credentials live per-ChannelConnection, not in env.
  SENDGRID_API_KEY: z.string().optional(),
  SENDGRID_FROM: z.string().optional(),

  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_NAME: z.string().optional(),
  R2_PUBLIC_URL: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),

  OUTBOUND_WORKER_CONCURRENCY: z.coerce.number().int().positive().optional(),
  AI_REPLY_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).optional(),
  QUALIFICATION_AI_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(100).optional(),
});

export type ValidatedEnv = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): ValidatedEnv {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
