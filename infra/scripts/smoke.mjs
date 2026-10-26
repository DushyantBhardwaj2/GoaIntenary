import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CognitoIdentityProviderClient, AdminCreateUserCommand, AdminSetUserPasswordCommand,
  AdminDeleteUserCommand, InitiateAuthCommand } from '@aws-sdk/client-cognito-identity-provider';
import { aws, region, root } from './aws-client.mjs';

const config = JSON.parse(await readFile(path.join(root, 'infra/config/dev.local.json'), 'utf8'));
const foundation = JSON.parse(await readFile(path.join(root, 'infra/deployment-outputs-goa-dev-foundation.json'), 'utf8'));
const runtime = JSON.parse(await readFile(path.join(root, 'infra/deployment-outputs-goa-dev-runtime.json'), 'utf8'));
const identity = await aws('sts', 'get-caller-identity');
assert.equal(identity.Account, config.accountId);
const session = await aws('configure', 'export-credentials', ['--format', 'process']);
const cognito = new CognitoIdentityProviderClient({ region, credentials: {
  accessKeyId: session.AccessKeyId, secretAccessKey: session.SecretAccessKey, sessionToken: session.SessionToken,
}, maxAttempts: 2 });
const created = [], checks = [];
let tripId, owner;
let phase = 'backend health';
function pass(message) { checks.push(message); console.log(`PASS: ${message}`); }
async function request(base, route, { token, method = 'GET', body, idempotency } = {}) {
  const response = await fetch(`${base}${route}`, { method, headers: {
    ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}),
    ...(idempotency ? { 'Idempotency-Key': idempotency } : {}),
  }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(35_000), redirect: 'error' });
  const text = await response.text();
  let value; try { value = text ? JSON.parse(text) : null; } catch { value = null; }
  return { status: response.status, body: value };
}
async function health(base) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try { const result = await request(base, '/health'); if (result.status === 200) return result.body; } catch { /* database may be resuming */ }
    if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 4_000));
  }
  throw new Error('Deployed backend health did not become ready.');
}
async function account(label) {
  const email = `goa-infra-${randomUUID()}-${label}@example.invalid`;
  const password = `Goa!1aA${randomBytes(24).toString('base64url')}`;
  const result = await cognito.send(new AdminCreateUserCommand({ UserPoolId: foundation.CognitoUserPoolId,
    Username: email, MessageAction: 'SUPPRESS', UserAttributes: [
      { Name: 'email', Value: email }, { Name: 'email_verified', Value: 'true' }, { Name: 'name', Value: `Infrastructure test ${label}` },
    ] }));
  const username = result.User.Username; created.push(username);
  await cognito.send(new AdminSetUserPasswordCommand({ UserPoolId: foundation.CognitoUserPoolId, Username: username, Password: password, Permanent: true }));
  const auth = await cognito.send(new InitiateAuthCommand({ ClientId: foundation.CognitoClientId,
    AuthFlow: 'USER_PASSWORD_AUTH', AuthParameters: { USERNAME: email, PASSWORD: password } }));
  assert.ok(auth.AuthenticationResult?.AccessToken);
  const claims = JSON.parse(Buffer.from(auth.AuthenticationResult.AccessToken.split('.')[1], 'base64url').toString());
  console.log(JSON.stringify({ identityCheck: label, tokenUse: claims.token_use, subjectVersion: claims.sub?.[14], subjectVariant: claims.sub?.[19] }));
  return { token: auth.AuthenticationResult.AccessToken };
}

try {
  const core = await health(runtime.CoreApiUrl);
  assert.equal(core.storage, 'postgres'); assert.equal(core.authMode, 'cognito');
  pass('Core API health uses real PostgreSQL and Cognito.');
  const discovery = await health(runtime.DiscoveryApiUrl);
  assert.ok(discovery.catalogueCount > 0);
  const places = await request(runtime.DiscoveryApiUrl, '/v1/places?q=Palolem');
  assert.equal(places.status, 200); assert.ok(places.body.places.length > 0);
  pass('Python discovery health and sourced catalogue work on Lambda.');
  assert.equal((await request(runtime.CoreApiUrl, '/v1/trips')).status, 401);
  pass('Private API rejects unauthenticated requests.');
  phase = 'Cognito identity creation and profile lookup';
  owner = await account('owner'); const member = await account('member'), outsider = await account('outsider');
  for (const person of [owner, member, outsider]) {
    const me = await request(runtime.CoreApiUrl, '/v1/me', person);
    if (me.status !== 200) console.error(JSON.stringify({ profileStatus: me.status, errorCode: me.body?.error?.code }));
    assert.equal(me.status, 200); person.userId = me.body.user.id;
  }
  pass('Three isolated, email-suppressed Cognito test identities authenticate.');
  phase = 'private trip persistence';
  const key = randomUUID();
  const input = { name: 'Infrastructure verification — synthetic', startDate: '2026-12-04', endDate: '2026-12-06' };
  const createdTrip = await request(runtime.CoreApiUrl, '/v1/trips', { ...owner, method: 'POST', body: input, idempotency: key });
  assert.equal(createdTrip.status, 201); tripId = createdTrip.body.trip.id;
  const retry = await request(runtime.CoreApiUrl, '/v1/trips', { ...owner, method: 'POST', body: input, idempotency: key });
  assert.equal(retry.body.trip.id, tripId);
  assert.equal((await request(runtime.CoreApiUrl, `/v1/trips/${tripId}`, outsider)).status, 404);
  pass('Trip writes persist, idempotent retry returns one trip, and an outsider is denied.');
  phase = 'private trip invitation';
  const invitation = await request(runtime.CoreApiUrl, `/v1/trips/${tripId}/invitations`, { ...owner, method: 'POST', body: { requiresApproval: false } });
  assert.equal(invitation.status, 201);
  const accepted = await request(runtime.CoreApiUrl, '/v1/invitations/accept', { ...member, method: 'POST', body: { token: invitation.body.invitation.token } });
  assert.equal(accepted.status, 200);
  assert.equal((await request(runtime.CoreApiUrl, `/v1/trips/${tripId}`, member)).status, 200);
  pass('A second Cognito account joins the private trip through the existing invitation contract.');
  phase = 'fresh Lambda persistence';
  const published = await aws('lambda', 'publish-version', ['--function-name', 'goa-dev-core', '--description', 'Infrastructure persistence verification']);
  const event = { version: '2.0', routeKey: '$default', rawPath: `/v1/trips/${tripId}`, rawQueryString: '',
    headers: { authorization: `Bearer ${owner.token}`, host: new URL(runtime.CoreApiUrl).host },
    requestContext: { requestId: randomUUID(), stage: '$default', http: { method: 'GET', path: `/v1/trips/${tripId}`, sourceIp: '127.0.0.1', protocol: 'HTTP/1.1', userAgent: 'goa-infra-verification' } }, isBase64Encoded: false };
  const resultPath = path.join(root, 'infra/artifacts/persistence-result.json');
  const invocation = await aws('lambda', 'invoke', ['--function-name', 'goa-dev-core', '--qualifier', published.Version,
    '--cli-binary-format', 'raw-in-base64-out', '--payload', JSON.stringify(event), resultPath]);
  assert.ok(!invocation.FunctionError);
  const result = JSON.parse(await readFile(resultPath, 'utf8'));
  assert.equal(result.statusCode, 200); assert.equal(JSON.parse(result.body).trip.id, tripId);
  pass('A separately initialized published Lambda version reads the persisted trip from PostgreSQL.');
  phase = 'removed member denial';
  assert.equal((await request(runtime.CoreApiUrl, `/v1/trips/${tripId}/members/${member.userId}`, { ...owner, method: 'DELETE' })).status, 204);
  assert.equal((await request(runtime.CoreApiUrl, `/v1/trips/${tripId}`, member)).status, 404);
  pass('Removed members lose private trip access.');
  await writeFile(path.join(root, 'infra/artifacts/live-verification.json'), JSON.stringify({ checkedAt: new Date().toISOString(), coreApiUrl: runtime.CoreApiUrl,
    discoveryApiUrl: runtime.DiscoveryApiUrl, persistenceVersion: published.Version, checks }, null, 2));
} catch (error) {
  console.error(`Live verification failed during ${phase} (${error.code || error.name || 'Error'}); credentials and provider details are suppressed.`);
  process.exitCode = 1;
} finally {
  if (tripId && owner) {
    try { assert.equal((await request(runtime.CoreApiUrl, `/v1/trips/${tripId}`, { ...owner, method: 'DELETE' })).status, 204); }
    catch { console.error('Synthetic trip cleanup needs attention.'); process.exitCode = 1; }
  }
  for (const username of created) {
    try { await cognito.send(new AdminDeleteUserCommand({ UserPoolId: foundation.CognitoUserPoolId, Username: username })); }
    catch { console.error('Synthetic Cognito identity cleanup needs attention.'); process.exitCode = 1; }
  }
  if (created.length) console.log('Synthetic Cognito test identities removed; no email was sent.');
}
