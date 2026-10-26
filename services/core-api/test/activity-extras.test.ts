import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/database.js';
import type { ActivityStatus } from '../src/trip-planning-types.js';

const secret = 'planning-synthetic-test-secret-with-32-bytes';
const ids = ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003'];
function token(index: number): string {
  const encoded = Buffer.from(JSON.stringify({ sub: ids[index], displayName: ['Aman', 'Riya', 'Dev'][index], email: ['aman', 'riya', 'dev'][index] + '@example.invalid', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  return `local.${encoded}.${createHmac('sha256', secret).update(`local.${encoded}`).digest('base64url')}`;
}
const isoTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

test('activity status and attendees stay with the plan', async (t) => {
  const testRoot = fileURLToPath(new URL('../../../.data/tests/', import.meta.url));
  await mkdir(testRoot, { recursive: true });
  const directory = await mkdtemp(join(testRoot, 'goa-activity-extras-test-'));
  const config = loadConfig({ NODE_ENV: 'test', ENABLE_LOCAL_DEMO: 'true', LOCAL_SESSION_SECRET: secret, PGLITE_DATA_DIR: directory });
  const database = await openDatabase(config);
  let app: FastifyInstance | undefined;
  try {
    app = await buildApp({ config, database, logger: false });
    const request = (index: number | null, method: InjectOptions['method'], url: string, payload?: unknown, headers: Record<string, string> = {}) => app!.inject({
      method, url, headers: { ...(payload !== undefined ? { 'content-type': 'application/json' } : {}), ...headers, ...(index === null ? {} : { authorization: `Bearer ${token(index)}` }) },
      ...(payload !== undefined ? { payload: JSON.stringify(payload) } : {}),
    });
    const created = await request(0, 'POST', '/v1/trips', { name: 'Manual Goa planner', startDate: '2026-12-04', endDate: '2026-12-06', region: 'north', travellerCount: 4, budgetPaise: 2_000_000, styles: ['beaches', 'food'] });
    assert.equal(created.statusCode, 201, created.body);
    const tripId = created.json().trip.id as string;
    const invitation = await request(0, 'POST', `/v1/trips/${tripId}/invitations`, { requiresApproval: false });
    assert.equal(invitation.statusCode, 201, invitation.body);
    const joined = await request(1, 'POST', '/v1/invitations/accept', { token: invitation.json().invitation.token });
    assert.equal(joined.statusCode, 200, joined.body);
    assert.equal(joined.json().status, 'accepted');
    const activity = await request(0, 'POST', `/v1/trips/${tripId}/activities`, { title: 'Beach morning', day: '2026-12-04', category: 'beach', startTime: '09:00', endTime: '10:00' });
    assert.equal(activity.statusCode, 201, activity.body);
    const activityId = activity.json().activity.id as string;
    const statusUrl = `/v1/trips/${tripId}/activities/${activityId}/status`;
    const attendeesUrl = `/v1/trips/${tripId}/activities/${activityId}/attendees`;
    const statusCount = async () => Number((await database.query<{ count: number | string }>('SELECT count(*)::int AS count FROM goa_core_activity_status WHERE activity_id=$1', [activityId]))[0]!.count);
    const attendeeRows = async () => database.query<{ trip_id: string; participant_id: string }>('SELECT trip_id::text AS trip_id, participant_id::text AS participant_id FROM goa_core_activity_attendees WHERE activity_id=$1 ORDER BY participant_id', [activityId]);
    const writeHits = async () => (await database.query<{ hits: number }>('SELECT hits FROM goa_core_rate_limits WHERE scope=$1', ['activity-extra-write'])).reduce((sum, row) => sum + Number(row.hits), 0);
    let meeraId = '';
    let kabirId = '';

    await t.test('GET status before any write returns planned and does not insert a row', async () => {
      const before = await statusCount();
      assert.equal(before, 0);
      const response = await request(1, 'GET', statusUrl);
      assert.equal(response.statusCode, 200, response.body);
      const body = response.json() as ActivityStatus;
      assert.equal(body.activityId, activityId);
      assert.equal(body.tripId, tripId);
      assert.equal(body.status, 'planned');
      assert.equal(body.updatedBy, null);
      assert.equal(body.updatedAt, null);
      assert.deepEqual(Object.keys(body).sort(), ['activityId', 'status', 'tripId', 'updatedAt', 'updatedBy']);
      assert.equal(await statusCount(), 0);
      assert.equal((await request(0, 'GET', `/v1/trips/${tripId}/activities/${randomUUID()}/status`)).statusCode, 404);
    });

    await t.test('set status confirmed and GET returns confirmed', async () => {
      const beforeHits = await writeHits();
      const rejected = await request(0, 'PUT', statusUrl, { status: 'booked' });
      assert.equal(rejected.statusCode, 400, rejected.body);
      assert.equal(await statusCount(), 0);
      const saved = await request(0, 'PUT', statusUrl, { status: 'confirmed' });
      assert.equal(saved.statusCode, 200, saved.body);
      const body = saved.json() as ActivityStatus;
      assert.equal(body.activityId, activityId);
      assert.equal(body.tripId, tripId);
      assert.equal(body.status, 'confirmed');
      assert.equal(body.updatedBy, ids[0]);
      if (body.updatedAt === null) assert.fail('updatedAt should be set');
      assert.match(body.updatedAt, isoTimestamp);
      const afterWrite = await writeHits();
      assert.ok(afterWrite >= beforeHits + 1);
      const seen = await request(1, 'GET', statusUrl);
      assert.equal(seen.statusCode, 200, seen.body);
      assert.equal(seen.json().status, 'confirmed');
      assert.equal(seen.json().updatedBy, ids[0]);
      assert.equal(await statusCount(), 1);
      assert.equal(await writeHits(), afterWrite);
      const audit = await database.query<{ target_id: string; target_key: string | null }>('SELECT target_id::text AS target_id, target_key FROM goa_core_audit WHERE trip_id=$1 AND action=$2', [tripId, 'activity_status.updated']);
      assert.equal(audit.length, 1);
      assert.equal(audit[0]!.target_id, activityId);
      assert.equal(audit[0]!.target_key, null);
      const again = await request(0, 'PUT', statusUrl, { status: 'confirmed' });
      assert.equal(again.statusCode, 200, again.body);
      assert.equal(await statusCount(), 1);
    });

    await t.test('replace attendees with two participant ids from this trip', async () => {
      const meera = await request(0, 'POST', `/v1/trips/${tripId}/expense-participants`, { displayName: 'Meera' });
      const kabir = await request(0, 'POST', `/v1/trips/${tripId}/expense-participants`, { displayName: 'Kabir' });
      assert.equal(meera.statusCode, 201, meera.body);
      assert.equal(kabir.statusCode, 201, kabir.body);
      meeraId = meera.json().participant.id as string;
      kabirId = kabir.json().participant.id as string;
      const beforeHits = await writeHits();
      const first = await request(0, 'PUT', attendeesUrl, { participantIds: [meeraId] });
      assert.equal(first.statusCode, 200, first.body);
      assert.deepEqual(first.json().participantIds, [meeraId]);
      const replaced = await request(1, 'PUT', attendeesUrl, { participantIds: [kabirId, meeraId] });
      assert.equal(replaced.statusCode, 200, replaced.body);
      assert.deepEqual(replaced.json().participantIds, [meeraId, kabirId].sort());
      const narrowed = await request(0, 'PUT', attendeesUrl, { participantIds: [kabirId] });
      assert.equal(narrowed.statusCode, 200, narrowed.body);
      assert.deepEqual(narrowed.json().participantIds, [kabirId]);
      const restored = await request(0, 'PUT', attendeesUrl, { participantIds: [meeraId, kabirId] });
      assert.equal(restored.statusCode, 200, restored.body);
      assert.deepEqual(Object.keys(restored.json()).sort(), ['participantIds']);
      assert.deepEqual(restored.json().participantIds, [meeraId, kabirId].sort());
      const seen = await request(1, 'GET', attendeesUrl);
      assert.equal(seen.statusCode, 200, seen.body);
      assert.deepEqual(seen.json().participantIds, [meeraId, kabirId].sort());
      const stored = await attendeeRows();
      assert.deepEqual(stored.map((row) => row.participant_id), [meeraId, kabirId].sort());
      assert.ok(stored.every((row) => row.trip_id === tripId));
      const audit = await database.query<{ target_id: string; target_key: string | null }>('SELECT target_id::text AS target_id, target_key FROM goa_core_audit WHERE trip_id=$1 AND action=$2 ORDER BY target_id', [tripId, 'activity_attendees.updated']);
      assert.ok(audit.length >= 4);
      assert.ok(audit.every((row) => row.target_id === activityId && row.target_key === null));
      assert.ok(await writeHits() >= beforeHits + 4);
    });

    await t.test('a participant id from another trip is 400 and does not change the set', async () => {
      const before = await attendeeRows();
      const other = await request(0, 'POST', '/v1/trips', { name: 'Somewhere else', startDate: '2026-12-04', endDate: '2026-12-06' });
      assert.equal(other.statusCode, 201, other.body);
      const foreign = await request(0, 'POST', `/v1/trips/${other.json().trip.id}/expense-participants`, { displayName: 'Foreign Guest' });
      assert.equal(foreign.statusCode, 201, foreign.body);
      const foreignId = foreign.json().participant.id as string;
      const rejected = await request(0, 'PUT', attendeesUrl, { participantIds: [foreignId] });
      assert.equal(rejected.statusCode, 400, rejected.body);
      assert.equal(rejected.json().error.code, 'VALIDATION_ERROR');
      assert.deepEqual(await attendeeRows(), before);
      const mixed = await request(0, 'PUT', attendeesUrl, { participantIds: [meeraId, foreignId] });
      assert.equal(mixed.statusCode, 400, mixed.body);
      assert.deepEqual(await attendeeRows(), before);
      const duplicate = await request(0, 'PUT', attendeesUrl, { participantIds: [meeraId, meeraId] });
      assert.equal(duplicate.statusCode, 400, duplicate.body);
      assert.deepEqual(await attendeeRows(), before);
      const unknown = await request(0, 'PUT', attendeesUrl, { participantIds: [randomUUID()] });
      assert.equal(unknown.statusCode, 400, unknown.body);
      assert.deepEqual(await attendeeRows(), before);
      const seen = await request(0, 'GET', attendeesUrl);
      assert.deepEqual(seen.json().participantIds, [meeraId, kabirId].sort());
      const cleared = await request(0, 'PUT', attendeesUrl, { participantIds: [] });
      assert.equal(cleared.statusCode, 200, cleared.body);
      assert.deepEqual(cleared.json().participantIds, []);
      assert.equal((await attendeeRows()).length, 0);
    });

    await t.test('Dev and a removed member get 404', async () => {
      const outsider = await request(2, 'GET', statusUrl);
      const unknownTrip = await request(2, 'GET', `/v1/trips/${randomUUID()}/activities/${activityId}/status`);
      assert.equal(outsider.statusCode, 404, outsider.body);
      assert.equal(outsider.json().error.message, 'That resource is unavailable.');
      assert.deepEqual(outsider.json(), unknownTrip.json());
      for (const [method, url, payload] of [
        ['GET', statusUrl, undefined],
        ['PUT', statusUrl, { status: 'cancelled' }],
        ['GET', attendeesUrl, undefined],
        ['PUT', attendeesUrl, { participantIds: [] }],
      ] as const) {
        const response = await request(2, method, url, payload);
        assert.equal(response.statusCode, 404, response.body);
        assert.equal(response.json().error.message, 'That resource is unavailable.');
      }
      const pendingInvite = await request(0, 'POST', `/v1/trips/${tripId}/invitations`, { requiresApproval: true });
      assert.equal(pendingInvite.statusCode, 201, pendingInvite.body);
      const pending = await request(2, 'POST', '/v1/invitations/accept', { token: pendingInvite.json().invitation.token });
      assert.equal(pending.statusCode, 200, pending.body);
      assert.equal(pending.json().status, 'pending');
      assert.equal((await request(2, 'GET', statusUrl)).statusCode, 404);
      assert.equal((await request(2, 'PUT', attendeesUrl, { participantIds: [] })).statusCode, 404);
      assert.equal((await request(0, 'DELETE', `/v1/trips/${tripId}/members/${ids[1]}`)).statusCode, 204);
      for (const [method, url, payload] of [
        ['GET', statusUrl, undefined],
        ['PUT', statusUrl, { status: 'planned' }],
        ['GET', attendeesUrl, undefined],
        ['PUT', attendeesUrl, { participantIds: [meeraId] }],
      ] as const) {
        const response = await request(1, method, url, payload);
        assert.equal(response.statusCode, 404, response.body);
        assert.equal(response.json().error.message, 'That resource is unavailable.');
      }
      const removed = await database.query<{ status: string }>('SELECT status FROM goa_core_memberships WHERE trip_id=$1 AND user_id=$2', [tripId, ids[1]]);
      assert.equal(removed[0]!.status, 'removed');
    });

    await t.test('after status cancelled, GET activities still includes that activity', async () => {
      const before = (await request(0, 'GET', `/v1/trips/${tripId}/activities`)).json().activities as { id: string; title: string }[];
      assert.equal(before.some((item) => item.id === activityId), true);
      const cancelled = await request(0, 'PUT', statusUrl, { status: 'cancelled' });
      assert.equal(cancelled.statusCode, 200, cancelled.body);
      assert.equal(cancelled.json().status, 'cancelled');
      assert.equal(cancelled.json().activityId, activityId);
      const listed = await request(0, 'GET', `/v1/trips/${tripId}/activities`);
      assert.equal(listed.statusCode, 200, listed.body);
      const after = listed.json().activities as { id: string; title: string }[];
      assert.deepEqual(after.map((item) => item.id), before.map((item) => item.id));
      assert.equal(after.find((item) => item.id === activityId)?.title, 'Beach morning');
      const reads = await request(0, 'GET', statusUrl);
      assert.equal(reads.json().status, 'cancelled');
      assert.equal((await request(0, 'DELETE', `/v1/trips/${tripId}/activities/${activityId}`)).statusCode, 204);
      const hidden = await statusCount();
      assert.equal((await request(0, 'GET', statusUrl)).statusCode, 404);
      assert.equal((await request(0, 'PUT', statusUrl, { status: 'planned' })).statusCode, 404);
      assert.equal((await request(0, 'GET', attendeesUrl)).statusCode, 404);
      assert.equal(await statusCount(), hidden);
      const remaining = (await request(0, 'GET', `/v1/trips/${tripId}/activities`)).json().activities as { id: string }[];
      assert.equal(remaining.some((item) => item.id === activityId), false);
    });
  } finally {
    if (app) await app.close();
    await database.close();
    assert.ok(resolve(directory).startsWith(resolve(testRoot) + sep));
    await rm(directory, { recursive: true, force: true });
  }
});
