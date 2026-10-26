import { loadConfig } from './config.js';
import { migrate, openDatabase } from './database.js';

async function main(): Promise<void> {
  const database = await openDatabase(loadConfig());
  try { await migrate(database); process.stdout.write('Core API migrations applied.\n'); }
  finally { await database.close(); }
}
main().catch(() => {
  process.stderr.write('Migration failed. Check database configuration; no connection details are logged.\n');
  process.exitCode = 1;
});
