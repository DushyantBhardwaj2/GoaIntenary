import { mkdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { Pool } from 'pg';
import { Signer } from '@aws-sdk/rds-signer';
import { secureDatabaseUrl, type CoreConfig } from './config.js';

export interface SqlClient {
  query<T = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
}
export interface Database extends SqlClient {
  readonly storage: 'pglite' | 'postgres';
  transaction<T>(work: (client: SqlClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export async function openDatabase(config: CoreConfig): Promise<Database> {
  if (config.databaseUrl) {
    const deployed = config.production || config.lambda;
    if (deployed && !config.databaseTls) throw new Error('A deployed database requires verified TLS.');
    const connectionString = deployed ? secureDatabaseUrl(config.databaseUrl) : config.databaseUrl;
    let connection: import('pg').PoolConfig = { connectionString };
    if (config.databaseIamAuth) {
      const url = new URL(secureDatabaseUrl(connectionString));
      if (url.password || !url.username || !url.pathname.slice(1) || [...url.searchParams].length || !config.databaseRegion || !config.databaseTls) {
        throw new Error('IAM database authentication requires a passwordless URL, region and verified TLS.');
      }
      const hostname = url.hostname, port = Number(url.port || 5432), username = decodeURIComponent(url.username);
      const signer = new Signer({ hostname, port, username, region: config.databaseRegion });
      // pg URL parsing overwrites a password callback. Supply individual fields
      // so each new connection gets a fresh IAM token, never a stored password.
      connection = { host: hostname, port, user: username, database: decodeURIComponent(url.pathname.slice(1)), password: () => signer.getAuthToken() };
    }
    const pool = new Pool({ ...connection, max: config.lambda ? 2 : 5,
      connectionTimeoutMillis: 8_000, idleTimeoutMillis: config.databaseIamAuth ? 1_000 : 30_000,
      allowExitOnIdle: config.databaseIamAuth,
      ...(config.databaseTls ? { ssl: { rejectUnauthorized: true } } : {}),
    });
    // Never log a pg Error: its detail/query can contain private values.
    pool.on('error', () => { process.stderr.write('PostgreSQL connection unavailable.\n'); });
    async function standalone(sql: string, values?: unknown[]) {
      if (!config.databaseIamAuth) return pool.query(sql, values);
      // Lambda can freeze before idle timers fire. Explicitly close IAM-backed
      // connections after each operation so an idle Express cluster can pause.
      const client = await pool.connect();
      try { return await client.query(sql, values); }
      finally { client.release(true); }
    }
    return {
      storage: 'postgres',
      async query<T>(sql: string, values?: unknown[]) { return (await standalone(sql, values)).rows as T[]; },
      async exec(sql) { await standalone(sql); },
      async transaction<T>(work: (client: SqlClient) => Promise<T>): Promise<T> {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await work({
            async query<R>(sql: string, values?: unknown[]) { return (await client.query(sql, values)).rows as R[]; },
            async exec(sql) { await client.query(sql); },
          });
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK').catch(() => undefined);
          throw error;
        } finally { client.release(config.databaseIamAuth); }
      },
      async close() { await pool.end(); },
    };
  }
  if (config.production || config.lambda) throw new Error('Embedded storage is restricted to local development.');
  await mkdir(config.pgliteDataDir, { recursive: true });
  const pglite = await PGlite.create(config.pgliteDataDir);
  // PGlite is a single PostgreSQL connection. Queue entire transactions, and
  // standalone reads/writes, so parallel HTTP requests cannot interleave them.
  let previous: Promise<unknown> = Promise.resolve();
  function serial<T>(work: () => Promise<T>): Promise<T> {
    const pending = previous.then(work, work);
    previous = pending.catch(() => undefined);
    return pending;
  }
  return {
    storage: 'pglite',
    query<T>(sql: string, values?: unknown[]) { return serial(async () => (await pglite.query<T>(sql, values)).rows); },
    exec(sql) { return serial(async () => { await pglite.exec(sql); }); },
    transaction<T>(work: (client: SqlClient) => Promise<T>): Promise<T> {
      return serial(() => pglite.transaction(async (tx) => work({
        async query<R>(sql: string, values?: unknown[]) { return (await tx.query<R>(sql, values)).rows; },
        async exec(sql) { await tx.exec(sql); },
      })));
    },
    close() { return serial(() => pglite.close()); },
  };
}

export const latestMigration = 4;
export async function migrate(database: Database, throughVersion = latestMigration): Promise<void> {
  const files = ['001_private_trips.sql', '002_premium_planner.sql', '003_selected_expense_splits.sql', '004_trip_planning.sql'];
  const migrations = await Promise.all(files.slice(0, throughVersion).map((file) => readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8')));
  await database.transaction(async (client) => {
    // Serialize concurrent deploys on PostgreSQL; the lock is transaction-scoped.
    await client.query('SELECT pg_advisory_xact_lock(7600101)');
    await client.exec('CREATE TABLE IF NOT EXISTS goa_core_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    for (const [index, sql] of migrations.entries()) {
      const version = index + 1;
      const applied = await client.query('SELECT version FROM goa_core_migrations WHERE version = $1', [version]);
      if (!applied.length) {
        await client.exec(sql);
        await client.query('INSERT INTO goa_core_migrations (version) VALUES ($1)', [version]);
      }
    }
  });
}
