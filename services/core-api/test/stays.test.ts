import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { migrate, openDatabase, type Database } from '../src/database.js';
import type { Stay } from '../src/trip-planning-types.js';

const secret = 'stays-synthetic-test-secret-with-32-bytes';
const ids = ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003'];
const checkIn = '2026-12-05T15:00:00+05:30';
const checkOut = '2026-12-07T11:00:00+05:30';
const phone = '0832-123456';

function token(index: number): string {
  const encoded = Buffer.from(JSON.stringify({ sub: ids[index], displayName: ['Aman', 'Riya', 'Dev'][index], email: ['aman', 'riya', 'dev'][index] + '@example.invalid', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  return `local.${encoded}.${createHmac('sha256', secret).update(`local.${encoded}`).digest('base64url')}`;
}

test('stays record guests, coordinates, membership, deletion, and retries', async (t) => {
  const testRoot = fileURLToPath(new URL('../../../.data/tests/', import.meta.url));
  await mkdir(testRoot, { recursive: true });
  const directory = await mkdtemp(join(testRoot, 'goa-stays-test-'));
  const config = loadConfig({ NODE_ENV: 'test', ENABLE_LOCAL_DEMO: 'true', LOCAL_SESSION_SECRET: secret, PGLITE_DATA_DIR: directory });
  const database = await openDatabase(config);
  let app: FastifyInstance | undefined;
  try {
    await migrate(database);
    app = await buildApp({ config, database, runMigrations: false, logger: false });
    const request = (index: number | null, method: InjectOptions['method'], url: string, payload?: unknown, headers: Record<string, string> = {}) => app!.inject({
      method, url, headers: { ...(payload !== undefined ? { 'content-type': 'application/json' } : {}), ...headers, ...(index === null ? {} : { authorization: `Bearer ${token(index)}` }) },
      ...(payload !== undefined ? { payload: JSON.stringify(payload) } : {}),
    });
    const created = await request(0, 'POST', '/v1/trips', { name: 'House hunt in Goa', startDate: '2026-12-04', endDate: '2026-12-08' });
    assert.equal(created.statusCode, 201, created.body);
    const tripId = created.json().trip.id as string;
    const staysUrl = `/v1/trips/${tripId}/stays`;
    const countStays = async () => Number((await database.query<{ count: number | string }>('SELECT count(*)::int AS count FROM goa_core_stays WHERE trip_id=$1', [tripId]))[0]!.count);
    const stayBody = (guestIds: string[], changes: Record<string, unknown> = {}) => ({
      propertyName: 'Palolem House', address: 'Palolem beach road', latitude: 15.5, longitude: 73.75,
      checkIn, checkOut, phone, contactName: 'Lata', notes: 'Gate code is with the group.', guestIds, ...changes,
    });

    let meeraId = '';
    let kabirId = '';
    let palolemId = '';
    let anjunaId = '';

    await t.test('outsider and pending member cannot read or write stays', async () => {
      const outsider = await request(2, 'GET', staysUrl);
      const unknown = await request(2, 'GET', `/v1/trips/${randomUUID()}/stays`);
      assert.equal(outsider.statusCode, 404, outsider.body);
      assert.deepEqual(outsider.json(), unknown.json());
      assert.equal((await request(2, 'POST', staysUrl, stayBody([]))).statusCode, 404);
      const invitation = await request(0, 'POST', `/v1/trips/${tripId}/invitations`, { requiresApproval: true });
      assert.equal(invitation.statusCode, 201, invitation.body);
      const accepted = await request(1, 'POST', '/v1/invitations/accept', { token: invitation.json().invitation.token });
      assert.equal(accepted.statusCode, 200, accepted.body);
      assert.equal(accepted.json().status, 'pending');
      assert.equal((await request(1, 'GET', staysUrl)).statusCode, 404);
      assert.equal((await request(1, 'POST', staysUrl, stayBody([]))).statusCode, 404);
      assert.equal((await request(0, 'POST', `/v1/trips/${tripId}/members/${ids[1]}/approve`)).statusCode, 200);
    });

    await t.test('creates a stay and assigns two guest participant ids', async () => {
      const meera = await request(0, 'POST', `/v1/trips/${tripId}/expense-participants`, { displayName: 'Meera' });
      const kabir = await request(0, 'POST', `/v1/trips/${tripId}/expense-participants`, { displayName: 'Kabir' });
      assert.equal(meera.statusCode, 201, meera.body);
      assert.equal(kabir.statusCode, 201, kabir.body);
      meeraId = meera.json().participant.id;
      kabirId = kabir.json().participant.id;
      const response = await request(0, 'POST', staysUrl, stayBody([meeraId, kabirId], { propertyName: '  Palolem House  ' }));
      assert.equal(response.statusCode, 201, response.body);
      const stay = response.json().stay as Stay;
      palolemId = stay.id;
      assert.equal(stay.tripId, tripId);
      assert.equal(stay.propertyName, 'Palolem House');
      assert.equal(stay.address, 'Palolem beach road');
      assert.equal(stay.latitude, 15.5);
      assert.equal(stay.longitude, 73.75);
      assert.equal(Date.parse(stay.checkIn), Date.parse(checkIn));
      assert.equal(Date.parse(stay.checkOut), Date.parse(checkOut));
      assert.equal(new Date(stay.checkIn).toISOString(), stay.checkIn);
      assert.equal(stay.phone, phone);
      assert.equal(stay.contactName, 'Lata');
      assert.equal(stay.notes, 'Gate code is with the group.');
      assert.equal(stay.createdBy, ids[0]);
      assert.deepEqual(stay.guestIds, [meeraId, kabirId].sort());
      assert.equal('reference' in stay, false);
      const links = await database.query<{ trip_id: string; participant_id: string }>('SELECT trip_id, participant_id::text AS participant_id FROM goa_core_stay_guests WHERE stay_id=$1 ORDER BY participant_id', [palolemId]);
      assert.deepEqual(links.map((row) => row.participant_id), [meeraId, kabirId].sort());
      assert.ok(links.every((row) => row.trip_id === tripId));
      const storedPhone = await database.query<{ phone: string }>('SELECT phone FROM goa_core_stays WHERE id=$1', [palolemId]);
      assert.equal(storedPhone[0]!.phone, phone);
      const anjuna = await request(0, 'POST', staysUrl, { propertyName: 'Anjuna Room', checkIn: '2026-12-04T14:00:00+05:30', checkOut: '2026-12-06T10:00:00+05:30', guestIds: [] });
      assert.equal(anjuna.statusCode, 201, anjuna.body);
      anjunaId = anjuna.json().stay.id;
      assert.equal(anjuna.json().stay.latitude, null);
      assert.equal(anjuna.json().stay.longitude, null);
      assert.deepEqual(anjuna.json().stay.guestIds, []);
      const listed = await request(1, 'GET', staysUrl);
      assert.equal(listed.statusCode, 200, listed.body);
      assert.deepEqual((listed.json().stays as Stay[]).map((item) => item.id), [anjunaId, palolemId]);
    });

    await t.test('rejects an impossible checkout, a lone coordinate, and guest ids that are not on this trip', async () => {
      const before = await countStays();
      const rejected = async (payload: Record<string, unknown>, message: RegExp) => {
        const response = await request(0, 'POST', staysUrl, payload);
        assert.equal(response.statusCode, 400, response.body);
        assert.match(response.json().error.message, message);
        assert.equal(await countStays(), before);
      };
      await rejected(stayBody([], { checkOut: checkIn }), /later than check-in/);
      await rejected(stayBody([], { checkIn: '2026-12-06T15:00:00+05:30', checkOut: '2026-12-05T15:00:00+05:30' }), /later than check-in/);
      await rejected(stayBody([], { latitude: 15.5, longitude: undefined }), /both latitude and longitude/);
      await rejected({ propertyName: 'North room', checkIn, checkOut, latitude: 15.5, guestIds: [] }, /both latitude and longitude/);
      await rejected({ propertyName: 'North room', checkIn, checkOut, latitude: 15.5, longitude: null, guestIds: [] }, /both latitude and longitude/);
      await rejected({ propertyName: 'North room', checkIn, checkOut, longitude: 73.75, guestIds: [] }, /both latitude and longitude/);
      await rejected({ propertyName: 'North room', checkIn, checkOut, latitude: null, longitude: 73.75, guestIds: [] }, /both latitude and longitude/);
      await rejected(stayBody([], { propertyName: '   ' }), /property name/);
      await rejected(stayBody([meeraId, meeraId]), /once/);
      await rejected(stayBody([randomUUID()]), /this trip/);
      const other = await request(0, 'POST', '/v1/trips', { name: 'Somewhere else', startDate: '2026-12-04', endDate: '2026-12-08' });
      assert.equal(other.statusCode, 201, other.body);
      const foreign = await request(0, 'POST', `/v1/trips/${other.json().trip.id}/expense-participants`, { displayName: 'Foreign Guest' });
      assert.equal(foreign.statusCode, 201, foreign.body);
      await rejected(stayBody([foreign.json().participant.id]), /this trip/);
      const invalidKey = await request(0, 'POST', staysUrl, stayBody([]), { 'idempotency-key': 'not-a-uuid' });
      assert.equal(invalidKey.statusCode, 400, invalidKey.body);
      assert.equal(await countStays(), before);
    });

    await t.test('a removed member gets 404 and a soft-deleted stay disappears from the list', async () => {
      assert.equal((await request(0, 'DELETE', `/v1/trips/${tripId}/members/${ids[1]}`)).statusCode, 204);
      for (const [method, url, payload] of [
        ['GET', staysUrl, undefined],
        ['POST', staysUrl, stayBody([])],
        ['PATCH', `${staysUrl}/${palolemId}`, stayBody([])],
        ['DELETE', `${staysUrl}/${palolemId}`, undefined],
      ] as const) {
        const response = await request(1, method, url, payload);
        assert.equal(response.statusCode, 404, response.body);
        assert.equal(response.json().error.message, 'That resource is unavailable.');
      }
      const removed = await request(0, 'DELETE', `${staysUrl}/${palolemId}`);
      assert.equal(removed.statusCode, 204, removed.body);
      const listed = await request(0, 'GET', staysUrl);
      assert.equal(listed.statusCode, 200, listed.body);
      const stays = listed.json().stays as Stay[];
      assert.deepEqual(stays.map((item) => item.id), [anjunaId]);
      assert.equal(stays[0]!.latitude, null);
      const hidden = await database.query<{ deleted_at: Date | string | null }>('SELECT deleted_at FROM goa_core_stays WHERE id=$1', [palolemId]);
      assert.ok(hidden[0]!.deleted_at);
      assert.equal((await request(0, 'GET', staysUrl)).json().stays.some((item: Stay) => item.id === palolemId), false);
      assert.equal((await request(0, 'PATCH', `${staysUrl}/${palolemId}`, stayBody([]))).statusCode, 404);
      assert.equal((await request(0, 'DELETE', `${staysUrl}/${palolemId}`)).statusCode, 404);
      assert.equal((await request(0, 'PATCH', `${staysUrl}/${randomUUID()}`, stayBody([]))).statusCode, 404);
    });

    await t.test('the same Idempotency-Key and body does not create a second stay', async () => {
      const before = await countStays();
      const key = randomUUID();
      const body = stayBody([kabirId], { propertyName: 'Retry House', phone: '0832-222333', latitude: null, longitude: null });
      const repeated = await Promise.all([
        request(0, 'POST', staysUrl, body, { 'idempotency-key': key }),
        request(0, 'POST', staysUrl, body, { 'idempotency-key': key }),
      ]);
      assert.deepEqual(repeated.map((response) => response.statusCode), [201, 201]);
      const first = repeated[0]!.json().stay as Stay;
      assert.equal(repeated[1]!.json().stay.id, first.id);
      assert.equal(await countStays(), before + 1);
      const conflict = await request(0, 'POST', staysUrl, { ...body, propertyName: 'Retry House changed' }, { 'idempotency-key': key });
      assert.equal(conflict.statusCode, 409, conflict.body);
      assert.equal(await countStays(), before + 1);
      const again = await request(0, 'POST', staysUrl, body, { 'idempotency-key': key });
      assert.equal(again.statusCode, 201, again.body);
      assert.equal(again.json().stay.id, first.id);
      assert.equal(await countStays(), before + 1);
      const names = await database.query<{ property_name: string }>('SELECT property_name FROM goa_core_stays WHERE trip_id=$1 AND property_name LIKE $2', [tripId, 'Retry House%']);
      assert.deepEqual(names.map((row) => row.property_name), ['Retry House']);
    });

    await t.test('editing replaces guests and can clear both coordinates', async () => {
      const patched = await request(0, 'PATCH', `${staysUrl}/${anjunaId}`, {
        propertyName: 'Anjuna Room', address: 'Updated lane', latitude: null, longitude: null,
        checkIn: '2026-12-04T14:00:00+05:30', checkOut: '2026-12-06T10:00:00+05:30',
        phone: '0832-333444', contactName: 'Rafi', notes: 'Pin removed', guestIds: [meeraId],
      });
      assert.equal(patched.statusCode, 200, patched.body);
      const stay = patched.json().stay as Stay;
      assert.equal(stay.latitude, null);
      assert.equal(stay.longitude, null);
      assert.deepEqual(stay.guestIds, [meeraId]);
      assert.equal(stay.phone, '0832-333444');
      assert.equal(stay.notes, 'Pin removed');
      const audits = await database.query<{ action: string; target_id: string; target_key: string | null }>(
        `SELECT action, target_id::text AS target_id, target_key FROM goa_core_audit WHERE trip_id=$1 AND action IN ('stay.created','stay.updated','stay.deleted') ORDER BY created_at, action`,
        [tripId],
      );
      assert.ok(audits.length >= 3);
      assert.ok(audits.every((row) => row.target_key === null));
      assert.ok(audits.some((row) => row.action === 'stay.created' && row.target_id === palolemId));
      assert.ok(audits.some((row) => row.action === 'stay.deleted' && row.target_id === palolemId));
      assert.ok(audits.some((row) => row.action === 'stay.updated' && row.target_id === anjunaId));
    });
  } finally {
    if (app) await app.close();
    await database.close();
    assert.ok(resolve(directory).startsWith(resolve(testRoot) + sep));
    await rm(directory, { recursive: true, force: true });
  }
});
