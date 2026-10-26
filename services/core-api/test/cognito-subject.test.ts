import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';
import { uuidPattern } from '../src/auth.js';
import { loadConfig } from '../src/config.js';
import { unauthenticated } from '../src/errors.js';

test('provider-issued UUID-shaped subjects work in profiles and membership URLs', async () => {
  // Shapes observed in live Cognito access-token subjects: variant f and 4.
  const ownerId = '70000000-0000-7000-f000-000000000001';
  const memberId = '70000000-0000-7000-4000-000000000002';
  assert.ok(uuidPattern.test(ownerId)); assert.ok(uuidPattern.test(memberId));
  for (const malformed of ['not-an-id', ownerId + '-extra', ownerId.replace('f000', 'g000'), '../' + ownerId]) assert.equal(uuidPattern.test(malformed), false);
  const testRoot = fileURLToPath(new URL('../../../.data/tests/', import.meta.url));
  await mkdir(testRoot, { recursive: true });
  const directory = await mkdtemp(join(testRoot, 'goa-cognito-subject-'));
  const config = loadConfig({ NODE_ENV: 'test', COGNITO_USER_POOL_ID: 'ap-south-1_Test', COGNITO_CLIENT_ID: 'test', PGLITE_DATA_DIR: directory });
  const identities = { owner: { id: ownerId, displayName: 'Provider owner' }, member: { id: memberId, displayName: 'Provider member' } };
  const app = await buildApp({ config, logger: false, authenticate: async token => {
    const identity = identities[token as keyof typeof identities];
    if (!identity) throw unauthenticated();
    return identity;
  } });
  const request = (who: string, method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown) => app.inject({ method, url,
    headers: { authorization: `Bearer ${who}`, ...(payload ? { 'content-type': 'application/json' } : {}) }, ...(payload ? { payload: JSON.stringify(payload) } : {}) });
  try {
    assert.equal((await request('invalid', 'GET', '/v1/me')).statusCode, 401);
    for (const who of ['owner', 'member']) assert.equal((await request(who, 'GET', '/v1/me')).statusCode, 200);
    const trip = await request('owner', 'POST', '/v1/trips', { name: 'Provider identity test', startDate: '2026-12-04', endDate: '2026-12-06' });
    assert.equal(trip.statusCode, 201);
    const id = trip.json().trip.id;
    const invitation = await request('owner', 'POST', `/v1/trips/${id}/invitations`, { requiresApproval: false });
    assert.equal(invitation.statusCode, 201);
    assert.equal((await request('member', 'POST', '/v1/invitations/accept', { token: invitation.json().invitation.token })).statusCode, 200);
    assert.equal((await request('member', 'GET', `/v1/trips/${id}`)).statusCode, 200);
    assert.equal((await request('owner', 'DELETE', `/v1/trips/${id}/members/${memberId}`)).statusCode, 204);
    assert.equal((await request('member', 'GET', `/v1/trips/${id}`)).statusCode, 404);
  } finally {
    await app.close();
    const target = resolve(directory);
    if (!target.startsWith(resolve(testRoot) + sep)) throw new Error('Test cleanup target escaped the workspace test directory.');
    await rm(target, { recursive: true, force: true });
  }
});
