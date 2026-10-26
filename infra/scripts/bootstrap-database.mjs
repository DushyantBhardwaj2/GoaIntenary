import { readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { aws, region, root } from './aws-client.mjs';

// This one-time administrator operation is separate from the application and
// migration identities. Its generated token exists only in this process.
let step = 'configuration';
try {
  const config = JSON.parse(await readFile(path.join(root, 'infra/config/dev.local.json'), 'utf8'));
  const identity = await aws('sts', 'get-caller-identity');
  if (identity.Account !== config.accountId || config.databaseHost === 'pending') throw new Error('Wrong account or missing development database.');
  const token = await aws('rds', 'generate-db-auth-token', ['--hostname', config.databaseHost, '--port', '5432', '--username', 'postgres'], { text: true });
  const administrator = new pg.Client({ host: config.databaseHost, user: 'postgres', password: token,
    database: 'postgres', port: 5432, ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 30_000 });
  try {
    step = 'connect to administrator database';
    await administrator.connect();
    step = 'inspect project database';
    const exists = await administrator.query("SELECT 1 FROM pg_database WHERE datname='goa'");
    step = 'create project database';
    if (!exists.rows.length) await administrator.query('CREATE DATABASE goa');
  } finally { await administrator.end(); }
  const client = new pg.Client({ host: config.databaseHost, user: 'postgres', password: token,
    database: config.databaseName, port: 5432, ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 30_000 });
  try {
    step = 'connect to project database';
    await client.connect();
    const statements = [
      ['begin bootstrap', 'BEGIN'],
      ['create project roles', `DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='goa_migrator') THEN CREATE ROLE goa_migrator LOGIN; END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='goa_core') THEN CREATE ROLE goa_core LOGIN; END IF;
      END $$`],
      ['grant IAM login', 'GRANT rds_iam TO goa_migrator, goa_core'],
      ['restrict public schema', 'REVOKE CREATE ON SCHEMA public FROM PUBLIC'],
      ['grant migration schema ownership', 'GRANT USAGE, CREATE ON SCHEMA public TO goa_migrator'],
      ['grant runtime schema access', 'GRANT USAGE ON SCHEMA public TO goa_core'],
      ['grant database connect', 'GRANT CONNECT ON DATABASE goa TO goa_migrator, goa_core'],
      ['commit bootstrap', 'COMMIT'],
    ];
    for (const [label, sql] of statements) { step = label; await client.query(sql); }
    const result = await client.query("SELECT current_database() AS database, (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS tls");
    if (!result.rows[0]?.tls) throw new Error('Database TLS verification failed.');
  } finally { await client.end(); }
  step = 'sign IAM migration role connection';
  const migrationToken = await aws('rds', 'generate-db-auth-token', ['--hostname', config.databaseHost, '--port', '5432', '--username', 'goa_migrator'], { text: true });
  const migrator = new pg.Client({ host: config.databaseHost, user: 'goa_migrator', password: migrationToken,
    database: config.databaseName, port: 5432, ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 30_000 });
  try {
    step = 'connect IAM migration role';
    await migrator.connect();
    step = 'configure object-owner default grants';
    await migrator.query('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO goa_core');
    await migrator.query('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO goa_core');
    if (process.argv.includes('--finalize')) {
      step = 'protect migration metadata';
      await migrator.query('REVOKE INSERT, UPDATE, DELETE ON goa_core_migrations FROM goa_core');
    }
    console.log(`Development PostgreSQL connected with verified TLS; ${process.argv.includes('--finalize') ? 'migration metadata protected' : 'separate runtime and migration SQL roles initialized'}.`);
  } finally { await migrator.end(); }
} catch (error) { console.error(`Database bootstrap failed at ${step} (${error.code || error.name || 'Error'}). Details are suppressed to protect temporary credentials.`); process.exitCode = 1; }
