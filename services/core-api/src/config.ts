import { fileURLToPath } from 'node:url';

export interface CoreConfig {
  production: boolean;
  lambda: boolean;
  localDemo: boolean;
  localSecret?: string;
  cognitoUserPoolId?: string;
  cognitoClientId?: string;
  cognitoRegion?: string;
  databaseUrl?: string;
  databaseTls: boolean;
  databaseIamAuth?: boolean;
  databaseRegion?: string;
  pgliteDataDir: string;
  host: string;
  port: number;
}

/** Prevent pg's connection-string parser from replacing explicit verified TLS. */
export function secureDatabaseUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error('Use a valid PostgreSQL connection URL.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || /[/\\]/.test(decodeURIComponent(url.hostname))) {
    throw new Error('A deployed database requires a PostgreSQL network endpoint.');
  }
  for (const [key, raw] of [...url.searchParams]) {
    const name = key.toLowerCase();
    const setting = raw.trim().toLowerCase();
    if (name === 'sslmode' && !['require', 'verify-full'].includes(setting)) {
      throw new Error('A deployed database requires certificate-verified TLS.');
    }
    if (name === 'ssl' && !['true', '1'].includes(setting)) {
      throw new Error('A deployed database cannot disable TLS verification.');
    }
    if (['sslrejectunauthorized', 'ssl.rejectunauthorized'].includes(name) && setting !== 'true') {
      throw new Error('A deployed database cannot disable certificate verification.');
    }
    if (name === 'host' && (!raw || /[/\\]/.test(raw))) {
      throw new Error('A deployed database requires a network endpoint.');
    }
    // sslmode/certificate options cause pg to replace its ssl object. Trust
    // configured CAs through NODE_EXTRA_CA_CERTS, retaining hostname checks.
    if (name.startsWith('ssl') || name === 'uselibpqcompat') url.searchParams.delete(key);
  }
  return url.toString();
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CoreConfig {
  const production = env.NODE_ENV === 'production';
  const lambda = Boolean(env.AWS_LAMBDA_FUNCTION_NAME || env.AWS_EXECUTION_ENV?.startsWith('AWS_Lambda_'));
  const localDemo = env.ENABLE_LOCAL_DEMO === 'true';
  if (localDemo && (production || lambda)) throw new Error('Synthetic accounts are restricted to local development.');
  if (localDemo && (!env.LOCAL_SESSION_SECRET || Buffer.byteLength(env.LOCAL_SESSION_SECRET) < 32)) {
    throw new Error('Local development requires a signing secret of at least 32 bytes.');
  }
  if (!localDemo && (!env.COGNITO_USER_POOL_ID || !env.COGNITO_CLIENT_ID)) {
    throw new Error('Configure Cognito pool/client, or explicitly enable local synthetic accounts.');
  }
  if ((production || lambda) && !env.DATABASE_URL) throw new Error('A deployed API requires PostgreSQL.');
  if ((production || lambda) && env.DATABASE_TLS?.trim().toLowerCase() === 'false') {
    throw new Error('TLS cannot be disabled for a deployed database.');
  }
  const databaseUrl = env.DATABASE_URL && (production || lambda) ? secureDatabaseUrl(env.DATABASE_URL) : env.DATABASE_URL;
  const databaseIamAuth = env.DATABASE_IAM_AUTH === 'true';
  if (databaseIamAuth) {
    if (!databaseUrl) throw new Error('IAM database authentication requires a PostgreSQL URL.');
    const url = new URL(secureDatabaseUrl(databaseUrl));
    if (url.password || !url.username || !url.pathname.slice(1) || [...url.searchParams].length) {
      throw new Error('IAM database URLs require a user and database, without passwords or query options.');
    }
    if (!env.DATABASE_REGION && !env.AWS_REGION) throw new Error('IAM database authentication requires the database region.');
    if (env.DATABASE_TLS?.trim().toLowerCase() === 'false') throw new Error('IAM database authentication requires verified TLS.');
  }
  const port = Number(env.PORT || 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid API port.');
  const host = env.HOST || '127.0.0.1';
  if (!production && !lambda && !['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error('The development API must listen on loopback.');
  }
  return {
    production, lambda, localDemo, localSecret: env.LOCAL_SESSION_SECRET,
    cognitoUserPoolId: env.COGNITO_USER_POOL_ID, cognitoClientId: env.COGNITO_CLIENT_ID,
    cognitoRegion: env.COGNITO_REGION || env.AWS_REGION || env.COGNITO_USER_POOL_ID?.split('_')[0],
    databaseUrl,
    databaseIamAuth, databaseRegion: env.DATABASE_REGION || env.AWS_REGION,
    databaseTls: production || lambda || databaseIamAuth || env.DATABASE_TLS === 'true',
    pgliteDataDir: env.PGLITE_DATA_DIR || fileURLToPath(new URL('../../../.data/core', import.meta.url)),
    host, port,
  };
}
