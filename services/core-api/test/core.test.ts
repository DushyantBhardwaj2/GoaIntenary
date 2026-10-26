import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { buildApp } from '../src/app.js';
import { verifyLocalToken } from '../src/auth.js';
import { loadConfig } from '../src/config.js';
import { migrate, openDatabase } from '../src/database.js';
import { TripRepository } from '../src/repository.js';
import type { Trip, Invitation } from '../src/types.js';

const secret = 'synthetic-test-secret-at-least-32-bytes-long';
const ids = ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003'] as const;
const names = ['Aman', 'Riya', 'Dev'];
const emails = ['aman@example.invalid', 'riya@example.invalid', 'dev@example.invalid'];
function sign(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(`local.${encoded}`).digest('base64url');
  return `local.${encoded}.${signature}`;
}
function token(index: number, expiry = Math.floor(Date.now() / 1000) + 3600): string {
  return sign({ sub: ids[index], displayName: names[index], email: emails[index], exp: expiry });
}
const tripInput = { name: 'Our three days in Goa', startDate: '2026-12-04', endDate: '2026-12-06', description: 'Synthetic test trip' };

test('IAM database configuration refuses stored passwords and unverifiable connections', () => {
  const base = { NODE_ENV: 'production', COGNITO_USER_POOL_ID: 'ap-south-1_example', COGNITO_CLIENT_ID: 'test',
    DATABASE_URL: 'postgresql://goa_core@db.example.invalid:5432/goa', DATABASE_IAM_AUTH: 'true', DATABASE_REGION: 'ap-south-1' };
  const config = loadConfig(base);
  assert.equal(config.databaseIamAuth, true);
  assert.equal(config.databaseTls, true);
  assert.equal(config.databaseRegion, 'ap-south-1');
  assert.throws(() => loadConfig({ ...base, DATABASE_URL: 'postgresql://goa_core:stored-password@db.example.invalid/goa' }), /without passwords/);
  assert.throws(() => loadConfig({ ...base, DATABASE_URL: 'postgresql://db.example.invalid/goa' }), /require a user/);
  assert.throws(() => loadConfig({ ...base, DATABASE_REGION: '' }), /database region/);
  assert.throws(() => loadConfig({ ...base, DATABASE_TLS: 'false' }), /TLS/);
  assert.throws(() => loadConfig({ ...base, DATABASE_URL: `${base.DATABASE_URL}?options=-c%20search_path%3Dother` }), /query options/);
  assert.throws(() => loadConfig({ ...base, DATABASE_URL: `${base.DATABASE_URL}?sslmode=disable` }), /TLS/);
});

test('synthetic auth fails closed and only accepts valid signed fixtures', () => {
  assert.equal(verifyLocalToken(token(0), secret).id, ids[0]);
  assert.throws(() => verifyLocalToken(token(0, 1), secret));
  assert.throws(() => verifyLocalToken(`${token(0)}wrong`, secret));
  assert.throws(() => verifyLocalToken(sign({ sub: ids[0], email: emails[0], displayName: names[0], exp: '9999999999' }), secret));
  assert.throws(() => verifyLocalToken(sign({ sub: randomUUID(), email: emails[0], displayName: names[0], exp: 9999999999 }), secret));
  assert.throws(() => verifyLocalToken(sign({ sub: ids[0], email: emails[1], displayName: names[0], exp: 9999999999 }), secret));
  assert.throws(() => loadConfig({ NODE_ENV: 'production', ENABLE_LOCAL_DEMO: 'true', LOCAL_SESSION_SECRET: secret }));
  assert.throws(() => loadConfig({ AWS_LAMBDA_FUNCTION_NAME: 'test', ENABLE_LOCAL_DEMO: 'true', LOCAL_SESSION_SECRET: secret }));
  assert.throws(() => loadConfig({ NODE_ENV: 'development', ENABLE_LOCAL_DEMO: 'true', LOCAL_SESSION_SECRET: 'short' }));
  assert.throws(() => loadConfig({ NODE_ENV: 'development', ENABLE_LOCAL_DEMO: 'true', LOCAL_SESSION_SECRET: secret, HOST: '0.0.0.0' }));
  assert.throws(() => loadConfig({ NODE_ENV: 'production', COGNITO_USER_POOL_ID: 'ap-south-1_example', COGNITO_CLIENT_ID: 'test' }));
});

test('deployed PostgreSQL always verifies TLS and cannot be weakened by URL options', () => {
  const base = { NODE_ENV: 'production', COGNITO_USER_POOL_ID: 'ap-south-1_example', COGNITO_CLIENT_ID: 'test', DATABASE_URL: 'postgresql://test:synthetic@db.example.invalid/goa' };
  assert.throws(() => loadConfig({ ...base, DATABASE_TLS: 'false' }), /TLS cannot be disabled/);
  assert.throws(() => loadConfig({ ...base, NODE_ENV: 'development', AWS_LAMBDA_FUNCTION_NAME: 'test', DATABASE_TLS: 'false' }), /TLS cannot be disabled/);
  for (const options of ['sslmode=disable', 'sslmode=no-verify', 'sslmode=prefer', 'sslmode=allow', 'sslmode=verify-ca',
    'sslrejectunauthorized=false', 'ssl.rejectUnauthorized=false', 'ssl=0', 'ssl=false', 'ssl=no-verify', 'host=%2Fvar%2Frun%2Fpostgresql']) {
    assert.throws(() => loadConfig({ ...base, DATABASE_URL: `${base.DATABASE_URL}?${options}` }));
  }
  assert.throws(() => loadConfig({ ...base, DATABASE_URL: `${base.DATABASE_URL}?sslmode=verify-full&sslmode=disable` }));
  assert.throws(() => loadConfig({ ...base, DATABASE_URL: `${base.DATABASE_URL}?SSLMODE=disable` }));
  for (const mode of ['verify-full', 'require']) {
    const config = loadConfig({ ...base, DATABASE_URL: `${base.DATABASE_URL}?sslmode=${mode}&sslrootcert=ignored.pem&uselibpqcompat=true&application_name=goa-core` });
    assert.equal(config.databaseTls, true);
    const sanitized = new URL(config.databaseUrl!);
    assert.equal(sanitized.searchParams.get('application_name'), 'goa-core');
    assert.equal(sanitized.searchParams.has('sslmode'), false);
    assert.equal(sanitized.searchParams.has('sslrootcert'), false);
    assert.equal(sanitized.searchParams.has('uselibpqcompat'), false);
  }
  const local = loadConfig({ NODE_ENV: 'development', ENABLE_LOCAL_DEMO: 'true', LOCAL_SESSION_SECRET: secret,
    DATABASE_URL: `${base.DATABASE_URL}?sslmode=disable`, DATABASE_TLS: 'false' });
  assert.equal(local.databaseTls, false);
  assert.match(local.databaseUrl!, /sslmode=disable/);
});

test('private trip contract against real persistent PostgreSQL engine', async (t) => {
  // The Windows sandbox's package Temp mount rejects PostgreSQL WAL renames.
  // Exercise persistence in the same workspace filesystem as the local server.
  const testRoot = fileURLToPath(new URL('../../../.data/tests/', import.meta.url));
  await mkdir(testRoot, { recursive: true });
  const directory = await mkdtemp(join(testRoot, 'goa-core-test-'));
  const config = loadConfig({ NODE_ENV: 'test', ENABLE_LOCAL_DEMO: 'true', LOCAL_SESSION_SECRET: secret, PGLITE_DATA_DIR: directory });
  let database = await openDatabase(config);
  let app: FastifyInstance | undefined;
  try {
    await migrate(database);
    await migrate(database); // Versioned migration is repeatable without resetting data.
    app = await buildApp({ config, database, runMigrations: false, logger: false });
    const request = async (index: number | null, method: InjectOptions['method'], url: string, payload?: unknown, headers: Record<string, string> = {}) => app!.inject({
      method, url, ...(payload !== undefined ? { payload: JSON.stringify(payload), headers: { 'content-type': 'application/json', ...headers,
        ...(index !== null ? { authorization: `Bearer ${token(index)}` } : {}) } } : {
        headers: { ...headers, ...(index !== null ? { authorization: `Bearer ${token(index)}` } : {}) },
      }),
    });
    let trip: Trip;
    let invitation: Invitation & { token: string };

    await t.test('health is public, all private reads require authentication and never cache', async () => {
      const health = await request(null, 'GET', '/health');
      assert.deepEqual(health.json(), { status: 'ok', authMode: 'local', storage: 'pglite' });
      const response = await request(null, 'GET', '/v1/trips');
      assert.equal(response.statusCode, 401);
      assert.equal(response.json().error.code, 'UNAUTHENTICATED');
      assert.match(response.headers['cache-control'] as string, /no-store/);
      const user = await request(0, 'GET', '/v1/me');
      assert.deepEqual(user.json().user, { id: ids[0], displayName: names[0], email: emails[0] });
      const remote = await app!.inject({ url: '/v1/me', remoteAddress: '192.0.2.10', headers: {
        authorization: `Bearer ${token(0)}`, 'x-forwarded-for': '127.0.0.1',
      } });
      assert.equal(remote.statusCode, 401);
    });

    await t.test('valid trip persists atomically with organiser and idempotent retries', async () => {
      const retry = randomUUID();
      const responses = await Promise.all([request(0, 'POST', '/v1/trips', tripInput, { 'idempotency-key': retry }), request(0, 'POST', '/v1/trips', tripInput, { 'idempotency-key': retry })]);
      assert.deepEqual(responses.map((response) => response.statusCode), [201, 201]);
      trip = responses[0]!.json().trip;
      assert.equal(trip.role, 'organiser');
      assert.equal(trip.startDate, tripInput.startDate);
      assert.deepEqual(responses[1]!.json().trip, trip);
      const conflict = await request(0, 'POST', '/v1/trips', { ...tripInput, name: 'Changed' }, { 'idempotency-key': retry });
      assert.equal(conflict.statusCode, 409);
      const list = await request(0, 'GET', '/v1/trips');
      assert.equal(list.json().trips.length, 1);
      const members = await database.query('SELECT * FROM goa_core_memberships WHERE trip_id = $1', [trip.id]);
      assert.equal(members.length, 1);
    });

    await t.test('copied URLs and unknown trips are indistinguishable to outsiders', async () => {
      const actual = await request(2, 'GET', `/v1/trips/${trip.id}`);
      const unknown = await request(2, 'GET', `/v1/trips/${randomUUID()}`);
      assert.equal(actual.statusCode, 404);
      assert.deepEqual(actual.json(), unknown.json());
      assert.deepEqual((await request(2, 'GET', '/v1/trips')).json(), { trips: [] });
      assert.equal((await request(2, 'POST', `/v1/trips/${trip.id}/invitations`, {})).statusCode, 404);
    });

    await t.test('default invitations require approval and store only hashes', async () => {
      const response = await request(0, 'POST', `/v1/trips/${trip.id}/invitations`, {});
      assert.equal(response.statusCode, 201);
      invitation = response.json().invitation;
      assert.equal(invitation.requiresApproval, true);
      assert.match(invitation.token, /^[A-Za-z0-9_-]{43}$/);
      const expiry = new Date(invitation.expiresAt).valueOf() - new Date(invitation.createdAt).valueOf();
      assert.equal(expiry, 7 * 24 * 60 * 60_000);
      const rows = await database.query<{ token_hash: string }>('SELECT token_hash FROM goa_core_invitations WHERE id = $1', [invitation.id]);
      assert.match(rows[0]!.token_hash, /^[0-9a-f]{64}$/);
      assert.notEqual(rows[0]!.token_hash, invitation.token);
      const detail = await request(0, 'GET', `/v1/trips/${trip.id}`);
      assert.equal(JSON.stringify(detail.json()).includes(invitation.token), false);
      assert.equal(JSON.stringify(detail.json()).includes(rows[0]!.token_hash), false);
    });

    await t.test('duplicate acceptance creates one pending member, no private access', async () => {
      const responses = await Promise.all([request(1, 'POST', '/v1/invitations/accept', { token: invitation.token }), request(1, 'POST', '/v1/invitations/accept', { token: invitation.token })]);
      for (const response of responses) {
        assert.equal(response.statusCode, 200);
        assert.deepEqual(response.json(), { tripId: trip.id, status: 'pending' });
      }
      assert.equal((await request(1, 'GET', `/v1/trips/${trip.id}`)).statusCode, 404);
      assert.deepEqual((await request(1, 'GET', '/v1/trips')).json().trips, []);
      assert.equal((await request(1, 'POST', `/v1/trips/${trip.id}/members/${ids[1]}/approve`)).statusCode, 404);
      const memberships = await database.query('SELECT * FROM goa_core_memberships WHERE trip_id = $1 AND user_id = $2', [trip.id, ids[1]]);
      assert.equal(memberships.length, 1);
      const acceptances = await database.query('SELECT * FROM goa_core_invitation_acceptances WHERE invitation_id = $1 AND user_id = $2', [invitation.id, ids[1]]);
      assert.equal(acceptances.length, 1);
    });

    await t.test('approval is organiser-only and idempotent; accepted member reads without invites', async () => {
      assert.equal((await request(2, 'POST', `/v1/trips/${trip.id}/members/${ids[1]}/approve`)).statusCode, 404);
      for (let repeat = 0; repeat < 2; repeat++) {
        const approved = await request(0, 'POST', `/v1/trips/${trip.id}/members/${ids[1]}/approve`);
        assert.equal(approved.statusCode, 200);
        assert.equal(approved.json().member.status, 'accepted');
      }
      const detail = await request(1, 'GET', `/v1/trips/${trip.id}`);
      assert.equal(detail.statusCode, 200);
      assert.equal(detail.json().trip.role, 'member');
      assert.deepEqual(detail.json().invitations, []);
      assert.equal(detail.json().members.length, 2);
      assert.equal((await request(1, 'GET', '/v1/trips')).json().trips[0].id, trip.id);
      assert.equal((await request(1, 'POST', `/v1/trips/${trip.id}/invitations`, {})).statusCode, 403);
      assert.equal((await request(1, 'DELETE', `/v1/trips/${trip.id}/members/${ids[0]}`)).statusCode, 403);
      assert.equal((await request(1, 'POST', '/v1/invitations/accept', { token: invitation.token })).json().status, 'accepted');
    });

    await t.test('removal is repeat-safe, preserves history, and blocks reads and old invitations', async () => {
      assert.equal((await request(0, 'DELETE', `/v1/trips/${trip.id}/members/${ids[0]}`)).statusCode, 409);
      for (let repeat = 0; repeat < 2; repeat++) assert.equal((await request(0, 'DELETE', `/v1/trips/${trip.id}/members/${ids[1]}`)).statusCode, 204);
      assert.equal((await request(1, 'GET', `/v1/trips/${trip.id}`)).statusCode, 404);
      assert.equal((await request(1, 'POST', '/v1/invitations/accept', { token: invitation.token })).statusCode, 404);
      assert.equal((await request(0, 'POST', `/v1/trips/${trip.id}/members/${ids[1]}/approve`)).statusCode, 404);
      const [row] = await database.query<{ status: string; removed_at: Date }>('SELECT status, removed_at FROM goa_core_memberships WHERE trip_id = $1 AND user_id = $2', [trip.id, ids[1]]);
      assert.equal(row!.status, 'removed');
      assert.ok(row!.removed_at);
      const history = await database.query<{ action: string }>('SELECT action FROM goa_core_audit WHERE trip_id = $1', [trip.id]);
      assert.ok(history.some((entry) => entry.action === 'membership.approved'));
      assert.equal(history.filter((entry) => entry.action === 'membership.removed').length, 1);
      assert.equal(history.filter((entry) => entry.action === 'membership.approved').length, 1);
    });

    await t.test('revoked, expired, and unknown invitations return the same safe error', async () => {
      const revoked = (await request(0, 'POST', `/v1/trips/${trip.id}/invitations`, {})).json().invitation;
      for (let repeat = 0; repeat < 2; repeat++) assert.equal((await request(0, 'DELETE', `/v1/trips/${trip.id}/invitations/${revoked.id}`)).statusCode, 204);
      const expired = (await request(0, 'POST', `/v1/trips/${trip.id}/invitations`, {})).json().invitation;
      // Keep the schema's expires-after-created invariant while moving the fixture into the past.
      await database.query("UPDATE goa_core_invitations SET created_at = now() - interval '8 days', expires_at = now() - interval '1 day' WHERE id = $1", [expired.id]);
      const responses = await Promise.all([revoked.token, expired.token, 'a'.repeat(43), 'invalid-token'].map((inviteToken) => request(2, 'POST', '/v1/invitations/accept', { token: inviteToken })));
      for (const response of responses) { assert.equal(response.statusCode, 404); assert.deepEqual(response.json(), responses[0]!.json()); }
    });

    await t.test('explicit no-approval links admit a current user but cannot restore removed membership', async () => {
      const link = (await request(0, 'POST', `/v1/trips/${trip.id}/invitations`, { requiresApproval: false })).json().invitation;
      assert.equal((await request(2, 'POST', '/v1/invitations/accept', { token: link.token })).json().status, 'accepted');
      const detail = await request(2, 'GET', `/v1/trips/${trip.id}`);
      assert.equal(detail.statusCode, 200);
      assert.equal(detail.json().members.length, 2);
      assert.ok(detail.json().members.every((member: { status: string }) => member.status === 'accepted'));
      assert.equal((await request(1, 'POST', '/v1/invitations/accept', { token: link.token })).statusCode, 404);
    });

    await t.test('unknown body fields, type coercion, path IDs, dates and malformed requests fail validation', async () => {
      const inputs = [
        { ...tripInput, authorId: ids[1] }, { ...tripInput, role: 'organiser' }, { ...tripInput, name: '   ' },
        { ...tripInput, startDate: '2026-02-30' }, { ...tripInput, startDate: '2026-13-01' },
        { ...tripInput, startDate: '2026-12-07' }, { ...tripInput, startDate: '2026-1-01' },
        { ...tripInput, startDate: '2025-02-29' }, { ...tripInput, name: 2 },
      ];
      for (const input of inputs) {
        const response = await request(0, 'POST', '/v1/trips', input);
        assert.equal(response.statusCode, 400);
        assert.equal(response.json().error.code, 'VALIDATION_ERROR');
      }
      assert.equal((await request(0, 'POST', `/v1/trips/${trip.id}/invitations`, { requiresApproval: 'false' })).statusCode, 400);
      assert.equal((await request(0, 'POST', `/v1/trips/${trip.id}/invitations`, { requiresApproval: false, role: 'organiser' })).statusCode, 400);
      assert.equal((await request(0, 'POST', `/v1/trips/${trip.id}/members/${ids[1]}/approve`, { status: 'accepted' })).statusCode, 400);
      assert.equal((await request(0, 'GET', '/v1/trips/not-a-uuid')).statusCode, 400);
      assert.equal((await request(0, 'POST', '/v1/trips', tripInput, { 'idempotency-key': 'invalid' })).statusCode, 400);
      assert.equal((await app!.inject({ method: 'POST', url: '/v1/trips', headers: { authorization: `Bearer ${token(0)}`, 'content-type': 'application/json' }, payload: '{invalid' })).statusCode, 400);
      const leap = await request(0, 'POST', '/v1/trips', { ...tripInput, startDate: '2028-02-29', endDate: '2028-02-29' });
      assert.equal(leap.statusCode, 201);
    });

    await t.test('database constraints and transaction rollback guard integrity independently of HTTP', async () => {
      await assert.rejects(() => database.query(`INSERT INTO goa_core_memberships (trip_id,user_id,role,status,joined_at)
        VALUES ($1,$2,'member','accepted',now())`, [trip.id, ids[0]]));
      await assert.rejects(() => database.query(`INSERT INTO goa_core_trips (id,name,start_date,end_date,created_by)
        VALUES ($1,'Invalid dates','2026-12-07','2026-12-04',$2)`, [randomUUID(), ids[0]]));
      await assert.rejects(() => database.query('UPDATE goa_core_audit SET action = action WHERE trip_id = $1', [trip.id]));
      const rollbackId = randomUUID();
      await assert.rejects(() => database.transaction(async (client) => {
        await client.query(`INSERT INTO goa_core_trips (id,name,start_date,end_date,created_by)
          VALUES ($1,'Rollback fixture','2026-12-04','2026-12-06',$2)`, [rollbackId, ids[0]]);
        throw new Error('Synthetic transaction failure');
      }));
      assert.equal((await database.query('SELECT id FROM goa_core_trips WHERE id = $1', [rollbackId])).length, 0);
      const repository = new TripRepository(database);
      await repository.rateLimit('test-sensitive-action', 'synthetic-key', 2);
      await repository.rateLimit('test-sensitive-action', 'synthetic-key', 2);
      await assert.rejects(() => repository.rateLimit('test-sensitive-action', 'synthetic-key', 2), { statusCode: 429 });
    });

    await t.test('saved trip and removed-member denial survive API/database restart', async () => {
      await app!.close();
      app = undefined;
      await database.close();
      database = await openDatabase(config);
      app = await buildApp({ config, database, runMigrations: true, logger: false });
      const persisted = await request(0, 'GET', `/v1/trips/${trip.id}`);
      assert.equal(persisted.statusCode, 200);
      assert.equal(persisted.json().trip.name, tripInput.name);
      assert.equal(persisted.json().invitations.length, 4);
      assert.equal((await request(1, 'GET', `/v1/trips/${trip.id}`)).statusCode, 404);
      assert.equal((await request(2, 'GET', `/v1/trips/${trip.id}`)).statusCode, 200);
    });
  } finally {
    if (app) await app.close();
    await database.close();
    assert.ok(resolve(directory).startsWith(resolve(testRoot) + sep));
    await rm(directory, { recursive: true, force: true });
  }
});
