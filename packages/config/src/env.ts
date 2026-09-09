export type KnightEnv = Readonly<{ NODE_ENV: string }>;

export function parseEnv(input: Record<string, string | undefined>): KnightEnv {
  void input;
  throw new Error('parseEnv not implemented');
}
