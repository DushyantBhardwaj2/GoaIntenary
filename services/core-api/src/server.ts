import { buildApp } from './app.js';
import { loadConfig } from './config.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildApp({ config });
  const shutdown = async () => { await app.close(); process.exit(0); };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  await app.listen({ host: config.host, port: config.port });
}

main().catch(() => {
  // Configuration/connection errors can include private connection strings.
  process.stderr.write('Core API could not start. Check its auth and database configuration.\n');
  process.exitCode = 1;
});
