import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_CLIENT_SECRET: z.string().min(1),
  AUTH_SECRET: z.string().min(32),
  APP_URL: z.string().url(),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
});

const WebEnvSchema = EnvSchema.pick({
  NODE_ENV: true,
  DISCORD_CLIENT_ID: true,
  DISCORD_CLIENT_SECRET: true,
  AUTH_SECRET: true,
  APP_URL: true,
  DATABASE_URL: true,
}).extend({
  DISCORD_TOKEN: EnvSchema.shape.DISCORD_TOKEN.optional(),
});

export type KnightEnv = z.infer<typeof EnvSchema>;
export type WebEnv = z.infer<typeof WebEnvSchema>;

export function parseEnv(input: Record<string, string | undefined>): KnightEnv {
  return EnvSchema.parse(input);
}

export function parseWebEnv(input: Record<string, string | undefined>): WebEnv {
  return WebEnvSchema.parse(input);
}
