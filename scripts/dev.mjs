import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const local = process.argv.includes('--local');
if (process.env.NODE_ENV === 'production' || process.env.AWS_LAMBDA_FUNCTION_NAME) {
  throw new Error('The development launcher cannot run in production or Lambda.');
}
// Optional local settings. Values are never printed; --local never uses a remote DB.
const envFile = path.join(root, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
if (process.env.NODE_ENV === 'production' || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.AWS_EXECUTION_ENV?.startsWith('AWS_Lambda_')) {
  throw new Error('The development launcher cannot run in production or Lambda.');
}
const corePort = Number(process.env.CORE_PORT || 4000);
const webPort = Number(process.env.WEB_PORT || 3000);
const discoveryPort = Number(process.env.DISCOVERY_PORT || 4100);
const discoveryPython = path.join(root, 'services', 'discovery', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
if (!existsSync(discoveryPython)) throw new Error('Discovery dependencies are not installed. Run npm run setup:discovery once.');
for (const port of [corePort, webPort, discoveryPort]) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid development port.');
  await new Promise((resolve, reject) => {
    const check = createServer();
    check.once('error', () => reject(new Error(`Port ${port} is already in use. Stop that process or choose CORE_PORT/WEB_PORT.`)));
    check.listen(port, '127.0.0.1', () => check.close(resolve));
  });
}
if (new Set([corePort, webPort, discoveryPort]).size !== 3) throw new Error('Core, discovery and web ports must differ.');
if (!local && (!process.env.COGNITO_USER_POOL_ID || !process.env.COGNITO_CLIENT_ID || !process.env.DATABASE_URL)) {
  throw new Error('Cognito/PostgreSQL are not configured. Use npm run dev:local for labelled synthetic test accounts, or configure .env using .env.example.');
}
const dataDir = path.join(root, '.data', 'core');
if (local) mkdirSync(dataDir, { recursive: true });
const shared = {
  ...process.env,
  NODE_ENV: 'development',
  ENABLE_LOCAL_DEMO: local ? 'true' : 'false',
  LOCAL_SESSION_SECRET: local ? randomBytes(48).toString('base64url') : '',
  CORE_API_URL: `http://127.0.0.1:${corePort}`,
  DISCOVERY_API_URL: `http://127.0.0.1:${discoveryPort}`,
  NEXT_TELEMETRY_DISABLED: '1',
  PGLITE_DATA_DIR: dataDir,
};
if (local) {
  // The test path must never accidentally write to an AWS database or identity pool.
  delete shared.DATABASE_URL;
  delete shared.DATABASE_IAM_AUTH;
  delete shared.DATABASE_REGION;
  delete shared.COGNITO_USER_POOL_ID;
  delete shared.COGNITO_CLIENT_ID;
}
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = code;
  const timer = setTimeout(() => process.exit(code), 3000);
  timer.unref();
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
const core = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
  cwd: path.join(root, 'services/core-api'),
  env: { ...shared, PORT: String(corePort), HOST: '127.0.0.1' },
  stdio: 'inherit',
  windowsHide: true,
});
children.push(core);
core.on('error', () => { console.error('Could not start core API. Run npm install first.'); stop(1); });
core.on('exit', code => { if (!stopping) stop(code || 1); });
const discovery = spawn(discoveryPython, ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(discoveryPort), '--no-access-log'], {
  cwd: path.join(root, 'services', 'discovery'), env: shared, stdio: 'inherit', windowsHide: true,
});
children.push(discovery);
discovery.on('error', () => { console.error('Could not start public discovery. Run npm run setup:discovery first.'); stop(1); });
discovery.on('exit', code => { if (!stopping) stop(code || 1); });
let ready = false;
for (let attempt = 0; attempt < 120 && !stopping; attempt++) {
  try {
    const responses = await Promise.all([shared.CORE_API_URL, shared.DISCOVERY_API_URL].map(url => fetch(`${url}/health`, { signal: AbortSignal.timeout(800) })));
    if (responses.every(response => response.ok)) { ready = true; break; }
  } catch { /* Wait for the local PostgreSQL engine and migration. */ }
  await new Promise(resolve => setTimeout(resolve, 500));
}
if (!ready) {
  console.error('The core and discovery APIs did not become ready. Review the configuration and error above.');
  stop(1);
} else {
  const web = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', String(webPort)], {
    cwd: path.join(root, 'apps/web'), env: shared, stdio: 'inherit', windowsHide: true,
  });
  children.push(web);
  web.on('error', () => { console.error('Could not start website.'); stop(1); });
  web.on('exit', code => { if (!stopping) stop(code || 1); });
  console.log(`Goa website: http://127.0.0.1:${webPort}`);
  console.log(local ? 'LOCAL TEST ACCOUNTS — saved trips use embedded PostgreSQL on this computer. No cloud resources.' : 'Development account mode — configured Cognito and PostgreSQL.');
}
