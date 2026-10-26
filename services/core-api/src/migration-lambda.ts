import { loadConfig } from './config.js';
import { latestMigration, migrate, openDatabase } from './database.js';

// No HTTP route: only an explicit, IAM-authorized development deployment invokes
// this function. The API's database user does not own the migration schema.
export async function handler(): Promise<{ status: string; version: number }> {
  const database = await openDatabase(loadConfig());
  try {
    await migrate(database);
    return { status: 'ok', version: latestMigration };
  } catch {
    throw new Error('Database migration failed; connection details are not logged.');
  } finally { await database.close(); }
}
