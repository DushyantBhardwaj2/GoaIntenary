import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { root, region } from './aws-client.mjs';

// Website-only development against the deployed backends. It does not launch a
// second API, run migrations, or pass database/AWS credentials to Next.js.
try {
  const foundation = JSON.parse(await readFile(path.join(root, 'infra/deployment-outputs-goa-dev-foundation.json'), 'utf8'));
  const runtime = JSON.parse(await readFile(path.join(root, 'infra/deployment-outputs-goa-dev-runtime.json'), 'utf8'));
  for (const value of [runtime.CoreApiUrl, runtime.DiscoveryApiUrl]) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname.endsWith(`.execute-api.${region}.amazonaws.com`)) throw new Error('Unexpected development API endpoint.');
  }
  const port = Number(process.env.WEB_PORT || 3000);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid development web port.');
  const env = { ...process.env, NODE_ENV: 'development', ENABLE_LOCAL_DEMO: 'false', LOCAL_SESSION_SECRET: '',
    COGNITO_REGION: region, COGNITO_USER_POOL_ID: foundation.CognitoUserPoolId, COGNITO_CLIENT_ID: foundation.CognitoClientId,
    CORE_API_URL: runtime.CoreApiUrl, DISCOVERY_API_URL: runtime.DiscoveryApiUrl,
    APP_ORIGIN: `http://127.0.0.1:${port}`, NEXT_TELEMETRY_DISABLED: '1' };
  for (const key of Object.keys(env)) if (key.startsWith('AWS_') || key.startsWith('DATABASE_') || key === 'GOA_AWS_ACCOUNT_ID') delete env[key];
  const require = createRequire(import.meta.url);
  const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', String(port)],
    { cwd: path.join(root, 'apps/web'), env, stdio: 'inherit', windowsHide: true });
  process.on('SIGINT', () => child.kill('SIGTERM'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
  child.on('error', () => { console.error('Could not start the website. Run npm install first.'); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code || 0; });
  console.log(`AWS-connected development website: http://127.0.0.1:${port}`);
  console.log('Cognito uses invited accounts; public registration is disabled.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
