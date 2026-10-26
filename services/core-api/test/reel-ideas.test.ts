import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { latestMigration, migrate, openDatabase } from '../src/database.js';
import type { ReelIdea, ReelIdeaInput } from '../src/reel-idea-types.js';

const secret = 'reel-ideas-synthetic-test-secret-with-32-bytes';
const ids = ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003'];
function token(index: number): string {
  const encoded = Buffer.from(JSON.stringify({ sub: ids[index], displayName: ['Aman', 'Riya', 'Dev'][index],
    email: ['aman', 'riya', 'dev'][index] + '@example.invalid', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  return `local.${encoded}.${createHmac('sha256', secret).update(`local.${encoded}`).digest('base64url')}`;
}
const tripInput = { name: 'Reel ideas trip', startDate: '2026-12-04', endDate: '2026-12-06' };
const input: ReelIdeaInput = { title: 'Sunset transition', kind: 'reel', instagramUrl: 'https://www.instagram.com/reel/example/',
  location: 'Palolem beach', notes: 'Film before sunset', participantUserIds: [ids[0]!] };

test('reel ideas persist with private membership, safe links and selected people', async (t) => {
  const testRoot = fileURLToPath(new URL('../../../.data/tests/', import.meta.url));
  await mkdir(testRoot, { recursive: true });
  const directory = await mkdtemp(join(testRoot, 'goa-reel-ideas-'));
  const config = loadConfig({ NODE_ENV: 'test', ENABLE_LOCAL_DEMO: 'true', LOCAL_SESSION_SECRET: secret, PGLITE_DATA_DIR: directory });
  let database = await openDatabase(config);
  let app: FastifyInstance | undefined;
  let tripId = '';
  let own: ReelIdea;
  let shared: ReelIdea;
  let pendingToken = '';
  const retry = randomUUID();
  const base = () => `/v1/trips/${tripId}/reel-ideas`;
  const request = (index: number | null, method: InjectOptions['method'], url: string, payload?: unknown, headers: Record<string, string> = {}) => app!.inject({
    method, url, headers: { ...(payload !== undefined ? { 'content-type': 'application/json' } : {}), ...headers,
      ...(index === null ? {} : { authorization: `Bearer ${token(index)}` }) }, ...(payload !== undefined ? { payload: JSON.stringify(payload) } : {}),
  });
  const list = async (index = 0) => {
    const response = await request(index, 'GET', base());
    assert.equal(response.statusCode, 200, response.body);
    return response.json().ideas as ReelIdea[];
  };
  try {
    await migrate(database, 4);
    app = await buildApp({ config, database, runMigrations: false, logger: false });
    const trip = await request(0, 'POST', '/v1/trips', tripInput);
    assert.equal(trip.statusCode, 201, trip.body);
    tripId = trip.json().trip.id;

    await t.test('migration 005 is additive and repeatable for existing trips', async () => {
      await migrate(database);
      await migrate(database);
      const versions = await database.query<{ version: number }>('SELECT version FROM goa_core_migrations ORDER BY version');
      assert.deepEqual(versions.map((row) => row.version), Array.from({ length: latestMigration }, (_, i) => i + 1));
      assert.deepEqual(await list(), []);
      assert.equal((await request(0, 'GET', `/v1/trips/${tripId}`)).json().trip.name, tripInput.name);
      assert.equal((await request(0, 'GET', '/health')).statusCode, 200);
    });

    await t.test('outsiders, pending members and unauthenticated callers cannot access ideas', async () => {
      assert.equal((await request(null, 'GET', base())).statusCode, 401);
      const created = await request(0, 'POST', base(), input);
      assert.equal(created.statusCode, 201, created.body);
      own = created.json().idea;
      for (const index of [1, 2]) {
        for (const [method, suffix, payload] of [
          ['GET', '', undefined], ['POST', '', input], ['PATCH', `/${own.id}`, { ...input, version: 1 }], ['DELETE', `/${own.id}`, undefined],
        ] as const) assert.equal((await request(index, method, base() + suffix, payload)).statusCode, 404);
      }
      const invitation = await request(0, 'POST', `/v1/trips/${tripId}/invitations`, { requiresApproval: true });
      pendingToken = invitation.json().invitation.token;
      assert.equal((await request(1, 'POST', '/v1/invitations/accept', { token: pendingToken })).json().status, 'pending');
      assert.equal((await request(1, 'GET', base())).statusCode, 404);
      assert.equal((await request(0, 'POST', base(), { ...input, participantUserIds: [ids[1]] })).statusCode, 400);
      assert.equal((await request(0, 'POST', `/v1/trips/${tripId}/members/${ids[1]}/approve`)).statusCode, 200);
    });

    await t.test('accepted members save reel/photo ideas with canonical people and retry-safe creation', async () => {
      const created = await request(1, 'POST', base(), { ...input, title: '  Beach group photo  ', kind: 'photo', instagramUrl: null,
        participantUserIds: [ids[1], ids[0], ids[1]!.toUpperCase()] }, { 'Idempotency-Key': retry });
      assert.equal(created.statusCode, 201, created.body);
      shared = created.json().idea;
      assert.equal(shared.title, 'Beach group photo');
      assert.equal(shared.kind, 'photo');
      assert.equal(shared.instagramUrl, null);
      assert.equal(shared.createdBy, ids[1]);
      assert.equal(shared.version, 1);
      assert.deepEqual(shared.participantUserIds, [ids[0], ids[1]]);
      assert.match(shared.createdAt, /Z$/);
      assert.equal((await list(0))[0]!.id, shared.id);
      assert.deepEqual((await list(1)).map((row) => row.id), (await list(0)).map((row) => row.id));
      const repeated = await request(1, 'POST', base(), { ...input, title: 'Beach group photo', kind: 'photo', instagramUrl: '',
        participantUserIds: [ids[0], ids[1]] }, { 'Idempotency-Key': retry });
      assert.equal(repeated.statusCode, 201, repeated.body);
      assert.equal(repeated.json().idea.id, shared.id);
      assert.equal((await request(1, 'POST', base(), { ...input, title: 'Different' }, { 'Idempotency-Key': retry })).statusCode, 409);
      assert.equal((await request(1, 'POST', base(), input, { 'Idempotency-Key': 'invalid-key' })).statusCode, 400);
      const audits = await database.query<{ count: number }>("SELECT count(*)::int AS count FROM goa_core_audit WHERE target_id=$1 AND action='reel-idea.created'", [shared.id]);
      assert.equal(audits[0]!.count, 1);
    });

    await t.test('unsafe links and invalid participants fail without consuming a retry key', async () => {
      for (const instagramUrl of ['javascript:alert(1)', 'http://instagram.com/reel/x', 'https://instagram.com.evil.invalid/x',
        'https://evilinstagram.com/x', 'https://instagram.com@evil.invalid/x', 'https://user:pass@instagram.com/x',
        'https://instagram.com:8443/x', 'https://instagram.com\\@evil.invalid/x', 'https://instagram.com/white space', 'https://instagram.com/\nx']) {
        const response = await request(0, 'POST', base(), { ...input, instagramUrl });
        assert.equal(response.statusCode, 400, `${instagramUrl}: ${response.body}`);
      }
      const otherTrip = await request(2, 'POST', '/v1/trips', { ...tripInput, name: 'Another trip' });
      assert.equal(otherTrip.statusCode, 201, otherTrip.body);
      const failedKey = randomUUID();
      assert.equal((await request(0, 'POST', base(), { ...input, participantUserIds: [ids[2]] }, { 'Idempotency-Key': failedKey })).statusCode, 400);
      const fixed = await request(0, 'POST', base(), { ...input, instagramUrl: 'https://instagram.com:443/reel/x' }, { 'Idempotency-Key': failedKey });
      assert.equal(fixed.statusCode, 201, fixed.body);
      assert.equal(fixed.json().idea.instagramUrl, 'https://instagram.com/reel/x');
      assert.equal((await request(0, 'POST', base(), { ...input, participantUserIds: [] })).statusCode, 400);
      assert.equal((await request(0, 'POST', base(), { ...input, participantUserIds: ['not-a-uuid'] })).statusCode, 400);
      assert.equal((await request(0, 'POST', base(), { ...input, title: '  ' })).statusCode, 400);
      assert.equal((await request(0, 'POST', base(), { ...input, title: 'x'.repeat(161) })).statusCode, 400);
      assert.equal((await request(0, 'POST', base(), { ...input, kind: 'video' })).statusCode, 400);
      assert.equal((await request(0, 'POST', base(), { ...input, createdBy: ids[1] })).statusCode, 400);
    });

    await t.test('creator and organiser edits are atomic and stale writes cannot overwrite', async () => {
      const edit = { ...input, participantUserIds: [ids[0]!, ids[1]!], title: 'Edited by organiser', version: shared.version };
      const edited = await request(0, 'PATCH', `${base()}/${shared.id}`, edit);
      assert.equal(edited.statusCode, 200, edited.body);
      shared = edited.json().idea;
      assert.equal(shared.version, 2);
      assert.equal(shared.createdBy, ids[1]);
      assert.equal((await request(1, 'PATCH', `${base()}/${own.id}`, { ...input, title: 'Not mine', version: 1 })).statusCode, 403);
      assert.equal((await request(1, 'DELETE', `${base()}/${own.id}`)).statusCode, 403);
      assert.equal((await request(1, 'PATCH', `${base()}/${shared.id}`, edit)).statusCode, 409);
      const concurrent = await Promise.all(['First change', 'Second change'].map((title) => request(1, 'PATCH', `${base()}/${shared.id}`, { ...input, title, version: shared.version })));
      assert.deepEqual(concurrent.map((response) => response.statusCode).sort(), [200, 409]);
      shared = concurrent.find((response) => response.statusCode === 200)!.json().idea;
      assert.equal(shared.version, 3);
      const before = await list();
      assert.equal((await request(1, 'PATCH', `${base()}/${shared.id}`, { ...input, version: shared.version, participantUserIds: [ids[2]] })).statusCode, 400);
      assert.deepEqual(await list(), before);
      const foreign = await request(2, 'POST', '/v1/trips', tripInput);
      assert.equal((await request(2, 'PATCH', `/v1/trips/${foreign.json().trip.id}/reel-ideas/${shared.id}`, { ...input, version: shared.version })).statusCode, 404);
    });

    await t.test('delete is authorised, audited and retry cannot resurrect a deleted idea', async () => {
      assert.equal((await request(1, 'DELETE', `${base()}/${shared.id}`)).statusCode, 204);
      assert.equal((await request(1, 'DELETE', `${base()}/${shared.id}`)).statusCode, 204);
      assert.equal((await request(1, 'PATCH', `${base()}/${shared.id}`, { ...input, version: shared.version })).statusCode, 404);
      assert.equal((await list()).some((row) => row.id === shared.id), false);
      const replay = await request(1, 'POST', base(), { ...input, title: 'Beach group photo', kind: 'photo', instagramUrl: null,
        participantUserIds: [ids[0], ids[1]] }, { 'Idempotency-Key': retry });
      assert.equal(replay.statusCode, 404);
      const removed = await database.query<{ count: number }>("SELECT count(*)::int AS count FROM goa_core_audit WHERE target_id=$1 AND action='reel-idea.deleted'", [shared.id]);
      assert.equal(removed[0]!.count, 1);
      assert.equal((await request(2, 'DELETE', `${base()}/${shared.id}`)).statusCode, 404);
      assert.equal((await request(0, 'DELETE', `${base()}/${own.id}`)).statusCode, 204);
      assert.equal((await request(1, 'DELETE', `${base()}/${own.id}`)).statusCode, 403);
    });

    await t.test('member removal blocks access and new selections while retaining stored attribution', async () => {
      const kept = await request(1, 'POST', base(), { ...input, title: 'Keep the original people', participantUserIds: [ids[0], ids[1]] });
      assert.equal(kept.statusCode, 201, kept.body);
      shared = kept.json().idea;
      assert.equal((await request(0, 'DELETE', `/v1/trips/${tripId}/members/${ids[1]}`)).statusCode, 204);
      for (const [method, suffix, payload] of [
        ['GET', '', undefined], ['POST', '', input], ['PATCH', `/${shared.id}`, { ...input, version: 1 }], ['DELETE', `/${shared.id}`, undefined],
      ] as const) assert.equal((await request(1, method, base() + suffix, payload)).statusCode, 404);
      assert.deepEqual((await list()).find((row) => row.id === shared.id)!.participantUserIds, [ids[0], ids[1]]);
      assert.equal((await request(0, 'POST', base(), { ...input, participantUserIds: [ids[1]] })).statusCode, 400);
      assert.equal((await request(0, 'PATCH', `${base()}/${shared.id}`, { ...input, version: shared.version, participantUserIds: [ids[1]] })).statusCode, 400);
      const corrected = await request(0, 'PATCH', `${base()}/${shared.id}`, { ...input, version: shared.version });
      assert.equal(corrected.statusCode, 200, corrected.body);
    });

    await t.test('a fresh app and database connection retain saved ideas', async () => {
      const before = await list();
      await app!.close();
      app = undefined;
      await database.close();
      database = await openDatabase(config);
      await migrate(database);
      app = await buildApp({ config, database, runMigrations: false, logger: false });
      assert.deepEqual(await list(), before);
      assert.equal((await request(0, 'DELETE', `${base()}/${shared.id}`)).statusCode, 204);
      assert.equal((await list()).some((row) => row.id === shared.id), false);
    });
  } finally {
    if (app) await app.close();
    await database.close();
    assert.ok(resolve(directory).startsWith(resolve(testRoot) + sep));
    await rm(directory, { recursive: true, force: true });
  }
});
