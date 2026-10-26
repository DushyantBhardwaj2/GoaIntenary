import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { migrate, openDatabase } from '../src/database.js';
import type { TravelSegment } from '../src/trip-planning-types.js';

const secret = 'travel-synthetic-test-secret-with-32-bytes!';
const ids = ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003'];
function token(index: number): string {
  const encoded = Buffer.from(JSON.stringify({ sub: ids[index], displayName: ['Aman', 'Riya', 'Dev'][index], email: ['aman', 'riya', 'dev'][index] + '@example.invalid', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  return `local.${encoded}.${createHmac('sha256', secret).update(`local.${encoded}`).digest('base64url')}`;
}

const flight = {
  mode: 'flight' as const,
  title: '  Mumbai to Goa  ',
  departurePlace: 'Mumbai airport',
  arrivalPlace: 'Goa airport',
  departureAt: '2026-12-04T10:30:00+05:30',
  arrivalAt: '2026-12-04T12:05:00+05:30',
  departureTerminal: 'Terminal 2, Gate 14',
  arrivalTerminal: 'Arrival hall',
  bookingReference: 'PNR-GOA-19',
  notes: 'Window seats if they are free',
  travellerIds: [] as string[],
};

test('accepted members save private flight, train, and bus segments', async () => {
  const testRoot = fileURLToPath(new URL('../../../.data/tests/', import.meta.url));
  await mkdir(testRoot, { recursive: true });
  const directory = await mkdtemp(join(testRoot, 'goa-travel-test-'));
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
    const countSegments = async (tripId: string) => (await database.query('SELECT id FROM goa_core_travel_segments WHERE trip_id=$1', [tripId])).length;

    const created = await request(0, 'POST', '/v1/trips', { name: 'Goa together', startDate: '2026-12-04', endDate: '2026-12-08' });
    assert.equal(created.statusCode, 201, created.body);
    const tripId = created.json().trip.id as string;
    const travelUrl = `/v1/trips/${tripId}/travel`;
    const invitation = await request(0, 'POST', `/v1/trips/${tripId}/invitations`, { requiresApproval: true });
    assert.equal(invitation.statusCode, 201, invitation.body);
    const accepted = await request(1, 'POST', '/v1/invitations/accept', { token: invitation.json().invitation.token });
    assert.equal(accepted.statusCode, 200, accepted.body);
    assert.equal(accepted.json().status, 'pending');

    const pendingRead = await request(1, 'GET', travelUrl);
    assert.equal(pendingRead.statusCode, 404);
    assert.equal(pendingRead.json().error.code, 'NOT_FOUND');
    assert.equal(pendingRead.json().error.message, 'That resource is unavailable.');
    const pendingWrite = await request(1, 'POST', travelUrl, { ...flight, title: 'Pending flight', travellerIds: [] }, { 'idempotency-key': randomUUID() });
    assert.equal(pendingWrite.statusCode, 404);
    assert.equal(pendingWrite.json().error.message, 'That resource is unavailable.');
    assert.equal(await countSegments(tripId), 0);

    const devRead = await request(2, 'GET', travelUrl);
    const unknownRead = await request(2, 'GET', `/v1/trips/${randomUUID()}/travel`);
    assert.equal(devRead.statusCode, 404);
    assert.deepEqual(devRead.json(), unknownRead.json());
    const devWrite = await request(2, 'POST', travelUrl, { ...flight, title: 'Outsider flight', travellerIds: [] });
    assert.equal(devWrite.statusCode, 404);
    assert.equal(devWrite.json().error.message, 'That resource is unavailable.');
    assert.equal(await countSegments(tripId), 0);

    const approved = await request(0, 'POST', `/v1/trips/${tripId}/members/${ids[1]}/approve`);
    assert.equal(approved.statusCode, 200, approved.body);
    const people = await request(0, 'GET', `/v1/trips/${tripId}/expense-participants`);
    assert.equal(people.statusCode, 200, people.body);
    const participants = people.json().participants as { id: string; userId: string | null }[];
    const aman = participants.find((person) => person.userId === ids[0]);
    const riya = participants.find((person) => person.userId === ids[1]);
    if (!aman || !riya) throw new Error('Accepted members have no expense participant rows.');
    const withTravellers = { ...flight, travellerIds: [aman.id, riya.id] };

    const early = await request(0, 'POST', travelUrl, { ...withTravellers, title: 'Too early', arrivalAt: '2026-12-04T09:00:00+05:30' });
    assert.equal(early.statusCode, 400, early.body);
    assert.equal(early.json().error.code, 'VALIDATION_ERROR');
    assert.equal(early.json().error.message, 'Arrival must be at the same time as departure or later.');
    assert.equal(await countSegments(tripId), 0);
    const badTime = await request(0, 'POST', travelUrl, { ...withTravellers, title: 'Bad clock', departureAt: 'tomorrow' });
    assert.equal(badTime.statusCode, 400, badTime.body);
    assert.equal(badTime.json().error.message, 'Use a valid departure time.');
    assert.equal(await countSegments(tripId), 0);
    const blankTitle = await request(0, 'POST', travelUrl, { ...withTravellers, title: '   ' });
    assert.equal(blankTitle.statusCode, 400, blankTitle.body);
    assert.equal(blankTitle.json().error.message, 'Give the segment a title.');
    const duplicateTravellers = await request(0, 'POST', travelUrl, { ...withTravellers, travellerIds: [aman.id, aman.id] });
    assert.equal(duplicateTravellers.statusCode, 400, duplicateTravellers.body);
    assert.equal(duplicateTravellers.json().error.message, 'Choose each traveller only once.');
    const unknownTraveller = await request(0, 'POST', travelUrl, { ...withTravellers, travellerIds: [randomUUID()] });
    assert.equal(unknownTraveller.statusCode, 400, unknownTraveller.body);
    assert.equal(unknownTraveller.json().error.message, 'Choose travellers from this trip.');

    const otherTrip = await request(0, 'POST', '/v1/trips', { name: 'Somewhere else', startDate: '2026-12-04', endDate: '2026-12-06' });
    assert.equal(otherTrip.statusCode, 201, otherTrip.body);
    const guest = await request(0, 'POST', `/v1/trips/${otherTrip.json().trip.id}/expense-participants`, { displayName: 'Other guest' }, { 'idempotency-key': randomUUID() });
    assert.equal(guest.statusCode, 201, guest.body);
    const foreignTraveller = await request(0, 'POST', travelUrl, { ...withTravellers, travellerIds: [guest.json().participant.id] });
    assert.equal(foreignTraveller.statusCode, 400, foreignTraveller.body);
    assert.equal(foreignTraveller.json().error.message, 'Choose travellers from this trip.');
    assert.equal(await countSegments(tripId), 0);

    const retry = randomUUID();
    const first = await request(0, 'POST', travelUrl, withTravellers, { 'idempotency-key': retry });
    assert.equal(first.statusCode, 201, first.body);
    const segment = first.json().segment as TravelSegment;
    const second = await request(0, 'POST', travelUrl, withTravellers, { 'idempotency-key': retry });
    assert.equal(second.statusCode, 201, second.body);
    assert.equal(second.json().segment.id, segment.id);
    assert.equal(await countSegments(tripId), 1);
    const createdAudits = await database.query<{ action: string }>('SELECT action FROM goa_core_audit WHERE trip_id=$1 AND action=$2', [tripId, 'travel.created']);
    assert.equal(createdAudits.length, 1);
    const different = await request(0, 'POST', travelUrl, { ...withTravellers, title: 'A different flight' }, { 'idempotency-key': retry });
    assert.equal(different.statusCode, 409, different.body);
    assert.equal(different.json().error.code, 'CONFLICT');
    assert.equal(await countSegments(tripId), 1);

    assert.equal(segment.createdBy, ids[0]);
    assert.equal(segment.mode, 'flight');
    assert.equal(segment.title, 'Mumbai to Goa');
    assert.equal(segment.departureTerminal, 'Terminal 2, Gate 14');
    assert.equal(segment.arrivalTerminal, 'Arrival hall');
    assert.equal(segment.bookingReference, 'PNR-GOA-19');
    assert.equal(segment.departureAt, '2026-12-04T05:00:00.000Z');
    assert.equal(segment.arrivalAt, '2026-12-04T06:35:00.000Z');
    assert.deepEqual(segment.travellerIds, [aman.id, riya.id].sort());

    const amanList = await request(0, 'GET', travelUrl);
    assert.equal(amanList.statusCode, 200, amanList.body);
    assert.equal(amanList.json().segments[0].bookingReference, 'PNR-GOA-19');
    assert.deepEqual(amanList.json().segments[0].travellerIds, [aman.id, riya.id].sort());
    const riyaList = await request(1, 'GET', travelUrl);
    assert.equal(riyaList.statusCode, 200, riyaList.body);
    assert.equal(riyaList.json().segments[0].bookingReference, 'PNR-GOA-19');
    assert.deepEqual(riyaList.json().segments[0].travellerIds, [aman.id, riya.id].sort());
    assert.deepEqual(riyaList.json().segments[0], amanList.json().segments[0]);

    const train = await request(1, 'POST', travelUrl, {
      mode: 'train', title: 'Earlier train', departurePlace: 'Mumbai', arrivalPlace: 'Madgaon',
      departureAt: '2026-12-04T08:00:00+05:30', arrivalAt: '2026-12-04T18:00:00+05:30',
      departureTerminal: 'Platform 3', arrivalTerminal: '', bookingReference: 'TRAIN-1', notes: '',
      travellerIds: [riya.id],
    });
    assert.equal(train.statusCode, 201, train.body);
    const ordered = await request(1, 'GET', travelUrl);
    assert.deepEqual(ordered.json().segments.map((item: TravelSegment) => item.id), [train.json().segment.id, segment.id]);
    const sorted = [...ordered.json().segments as TravelSegment[]].sort((left, right) => left.departureAt.localeCompare(right.departureAt) || left.id.localeCompare(right.id));
    assert.deepEqual(ordered.json().segments.map((item: TravelSegment) => item.id), sorted.map((item) => item.id));

    const patched = await request(0, 'PATCH', `${travelUrl}/${segment.id}`, {
      ...withTravellers, title: 'Mumbai to Goa', mode: 'bus', bookingReference: 'BUS-2', travellerIds: [riya.id], notes: 'Coach 4',
    });
    assert.equal(patched.statusCode, 200, patched.body);
    assert.equal(patched.json().segment.id, segment.id);
    assert.equal(patched.json().segment.mode, 'bus');
    assert.equal(patched.json().segment.bookingReference, 'BUS-2');
    assert.equal(patched.json().segment.notes, 'Coach 4');
    assert.deepEqual(patched.json().segment.travellerIds, [riya.id]);
    const afterPatch = await request(1, 'GET', travelUrl);
    const savedFlight = (afterPatch.json().segments as TravelSegment[]).find((item) => item.id === segment.id);
    assert.equal(savedFlight?.bookingReference, 'BUS-2');
    assert.deepEqual(savedFlight?.travellerIds, [riya.id]);

    const removed = await request(0, 'DELETE', `/v1/trips/${tripId}/members/${ids[1]}`);
    assert.equal(removed.statusCode, 204, removed.body);
    const removedRead = await request(1, 'GET', travelUrl);
    assert.equal(removedRead.statusCode, 404);
    assert.equal(removedRead.json().error.message, 'That resource is unavailable.');
    assert.equal((await request(1, 'PATCH', `${travelUrl}/${segment.id}`, withTravellers)).statusCode, 404);
    assert.equal((await request(1, 'DELETE', `${travelUrl}/${segment.id}`)).statusCode, 404);
    assert.equal((await request(1, 'POST', travelUrl, { ...withTravellers, title: 'Removed write' })).statusCode, 404);

    assert.equal((await request(0, 'DELETE', `${travelUrl}/${segment.id}`)).statusCode, 204);
    assert.equal((await request(0, 'DELETE', `${travelUrl}/${train.json().segment.id}`)).statusCode, 204);
    const hidden = await request(0, 'GET', travelUrl);
    assert.equal(hidden.statusCode, 200, hidden.body);
    assert.deepEqual(hidden.json().segments, []);
    assert.equal(hidden.body.includes('PNR-GOA-19'), false);
    assert.equal(hidden.body.includes('BUS-2'), false);
    const stored = await database.query<{ booking_reference: string; deleted_at: Date | string | null }>('SELECT booking_reference, deleted_at FROM goa_core_travel_segments WHERE id=$1', [segment.id]);
    assert.equal(stored[0]!.booking_reference, 'BUS-2');
    assert.ok(stored[0]!.deleted_at);
    assert.equal((await request(0, 'PATCH', `${travelUrl}/${segment.id}`, withTravellers)).statusCode, 404);
    assert.equal((await request(0, 'DELETE', `${travelUrl}/${segment.id}`)).statusCode, 404);
    assert.equal((await request(0, 'PATCH', `${travelUrl}/${randomUUID()}`, withTravellers)).statusCode, 404);

    const audits = await database.query<{ action: string; target_id: string; target_key: string | null }>(
      'SELECT action, target_id::text, target_key FROM goa_core_audit WHERE trip_id=$1 AND action LIKE \'travel.%\'', [tripId]);
    assert.deepEqual(audits.map((row) => row.action).sort(), ['travel.created', 'travel.created', 'travel.deleted', 'travel.deleted', 'travel.updated']);
    assert.ok(audits.every((row) => row.target_key === null));
    assert.ok(audits.every((row) => row.target_id === segment.id || row.target_id === train.json().segment.id));
    assert.equal(audits.some((row) => row.target_key === 'PNR-GOA-19' || row.target_key === 'BUS-2'), false);

    const sameInstant = await request(0, 'POST', travelUrl, {
      mode: 'bus', title: 'Same instant', departurePlace: 'Panaji', arrivalPlace: 'Mapusa',
      departureAt: '2026-12-05T09:00:00+05:30', arrivalAt: '2026-12-05T09:00:00+05:30',
      departureTerminal: '', arrivalTerminal: '', bookingReference: '', notes: '', travellerIds: [],
    });
    assert.equal(sameInstant.statusCode, 201, sameInstant.body);
    assert.equal(sameInstant.json().segment.arrivalAt, sameInstant.json().segment.departureAt);
    assert.deepEqual(sameInstant.json().segment.travellerIds, []);
    assert.equal(await countSegments(tripId), 3);
  } finally {
    if (app) await app.close();
    await database.close();
    assert.ok(resolve(directory).startsWith(resolve(testRoot) + sep));
    await rm(directory, { recursive: true, force: true });
  }
});
