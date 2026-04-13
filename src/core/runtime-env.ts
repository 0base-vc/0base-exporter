function parseInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getOptionalEnv(
  name: keyof NodeJS.ProcessEnv | string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return env[name]?.trim() ?? "";
}

export function getDecimalPlaces(fallback: number, env: NodeJS.ProcessEnv = process.env): number {
  return parseInteger(env.DECIMAL_PLACES, fallback);
}

export function getEvmApiUrl(env: NodeJS.ProcessEnv = process.env): string {
  return getOptionalEnv("EVM_API_URL", env);
}

export function getAlchemyApiKey(env: NodeJS.ProcessEnv = process.env): string {
  return getOptionalEnv("ALCHEMY_API_KEY", env);
}

export function getMonadValidatorId(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = getOptionalEnv("MONAD_VALIDATOR_ID", env) || getOptionalEnv("VALIDATOR_ID", env);
  return value || undefined;
}
