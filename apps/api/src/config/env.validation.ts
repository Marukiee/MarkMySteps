/**
 * Environment validation — fails fast at boot with a readable message
 * instead of crashing later with an obscure runtime error.
 */

const REQUIRED_VARS = ['DATABASE_URL', 'JWT_SECRET', 'MASTER_ENCRYPTION_KEY'] as const;

export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const missing = REQUIRED_VARS.filter((key) => {
    const value = config[key];
    return typeof value !== 'string' || value.length === 0 || value === 'change-me';
  });

  if (missing.length > 0) {
    throw new Error(
      `Missing or placeholder environment variables: ${missing.join(', ')}. ` +
        'Copy .env.example to .env and generate real secrets (see comments in the file).',
    );
  }

  const masterKey = Buffer.from(String(config.MASTER_ENCRYPTION_KEY), 'base64');
  if (masterKey.length !== 32) {
    throw new Error(
      'MASTER_ENCRYPTION_KEY must be exactly 32 bytes, base64-encoded. ' +
        'Generate one with: openssl rand -base64 32',
    );
  }

  const jwtSecret = String(config.JWT_SECRET);
  if (jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters. Generate: openssl rand -base64 48');
  }

  return config;
}
