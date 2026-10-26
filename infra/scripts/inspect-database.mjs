import { readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import assert from 'node:assert/strict';
import { aws, root } from './aws-client.mjs';

const config = JSON.parse(await readFile(path.join(root, 'infra/config/dev.local.json'), 'utf8'));
const identity = await aws('sts', 'get-caller-identity');
if (identity.Account !== config.accountId) throw new Error('Wrong AWS account.');
const password = await aws('rds', 'generate-db-auth-token', ['--hostname', config.databaseHost, '--port', '5432', '--username', 'postgres'], { text: true });
const client = new pg.Client({ host: config.databaseHost, user: 'postgres', password, database: 'postgres', port: 5432,
  ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 30_000 });
try {
  await client.connect();
  const role = await client.query('SELECT current_user,rolcreatedb,rolcreaterole,rolsuper FROM pg_roles WHERE rolname=current_user');
  const databases = await client.query("SELECT datname FROM pg_database WHERE datname IN ('goa','postgres')");
  const roles = await client.query("SELECT rolname FROM pg_roles WHERE rolname IN ('goa_core','goa_migrator')");
  console.log(JSON.stringify({ administrator: role.rows[0], databases: databases.rows, projectRoles: roles.rows }));
} catch (error) { console.error(`Database inspection failed (${error.code || error.name}).`); process.exitCode = 1; }
finally { await client.end(); }
if (process.argv.includes('--runtime')) {
  const runtimeToken = await aws('rds', 'generate-db-auth-token', ['--hostname', config.databaseHost, '--port', '5432', '--username', 'goa_core'], { text: true });
  const runtime = new pg.Client({ host: config.databaseHost, user: 'goa_core', password: runtimeToken, database: config.databaseName, port: 5432,
    ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 30_000 });
  try {
    await runtime.connect();
    const result = await runtime.query(`SELECT current_user,
      has_schema_privilege(current_user,'public','CREATE') AS can_create,
      has_table_privilege(current_user,'goa_core_migrations','SELECT') AS can_read_migrations,
      has_table_privilege(current_user,'goa_core_migrations','INSERT') AS can_write_migrations,
      (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS tls`);
    const row = result.rows[0];
    assert.equal(row.current_user, 'goa_core'); assert.equal(row.can_create, false);
    assert.equal(row.can_read_migrations, true); assert.equal(row.can_write_migrations, false); assert.equal(row.tls, true);
    const versions = await runtime.query('SELECT version FROM goa_core_migrations ORDER BY version');
    console.log(JSON.stringify({ runtime: row, migrationVersions: versions.rows.map(item => item.version) }));
  } catch (error) { console.error(`Runtime SQL boundary verification failed (${error.code || error.name}).`); process.exitCode = 1; }
  finally { await runtime.end(); }
}
