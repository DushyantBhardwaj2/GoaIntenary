import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { region, root } from './aws-client.mjs';

const foundation = JSON.parse(await readFile(path.join(root, 'infra/deployment-outputs-goa-dev-foundation.json'), 'utf8'));
const runtime = JSON.parse(await readFile(path.join(root, 'infra/deployment-outputs-goa-dev-runtime.json'), 'utf8'));
const values = { COGNITO_REGION: region, COGNITO_USER_POOL_ID: foundation.CognitoUserPoolId,
  COGNITO_CLIENT_ID: foundation.CognitoClientId, CORE_API_URL: runtime.CoreApiUrl,
  DISCOVERY_API_URL: runtime.DiscoveryApiUrl, ENABLE_LOCAL_DEMO: 'false', APP_ORIGIN: '' };
const target = path.join(root, 'infra/artifacts/web.env');
await writeFile(target, '# Server environment only. Set APP_ORIGIN to the exact HTTPS preview origin.\n'
  + Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n');
console.log('Vercel server environment exported to infra/artifacts/web.env; APP_ORIGIN needs the selected preview URL. No database or AWS credentials are included.');
