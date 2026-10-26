import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDatabase, type Database } from '../src/database.js';
import type { Booking } from '../src/trip-planning-types.js';

const secret = 'bookings-synthetic-test-secret-with-32-bytes';
const ids = ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003'];
function token(index: number): string {
  const encoded = Buffer.from(JSON.stringify({ sub: ids[index], displayName: ['Aman', 'Riya', 'Dev'][index], email: ['aman', 'riya', 'dev'][index] + '@example.invalid', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  return `local.${encoded}.${createHmac('sha256', secret).update(`local.${encoded}`).digest('base64url')}`;
}
const tripInput = { name: 'Booking links', startDate: '2026-12-04', endDate: '2026-12-06', region: 'north', travellerCount: 4, budgetPaise: 2_000_000, styles: ['beaches'] };
const stayInput = { propertyName: 'Palm House', checkIn: '2026-12-04T14:00:00.000Z', checkOut: '2026-12-06T11:00:00.000Z', guestIds: [] as string[] };
const travelInput = { mode: 'flight', title: 'Into Dabolim', departurePlace: 'Mumbai', arrivalPlace: 'Dabolim', departureAt: '2026-12-04T08:00:00.000Z', travellerIds: [] as string[] };

function assertBookingOrder(bookings: Booking[]): void {
  for (let index = 1; index < bookings.length; index += 1) {
    const previous = bookings[index - 1]!;
    const current = bookings[index]!;
    const order = previous.createdAt.localeCompare(current.createdAt) || previous.id.localeCompare(current.id);
    assert.ok(order <= 0, `${previous.id} should come before ${current.id}`);
  }
}

test('one live booking links an activity, stay, or travel segment', async (t) => {
  const testRoot = fileURLToPath(new URL('../../../.data/tests/', import.meta.url));
  await mkdir(testRoot, { recursive: true });
  let directory: string | undefined;
  let database: Database | undefined;
  let app: FastifyInstance | undefined;
  try {
    directory = await mkdtemp(join(testRoot, 'goa-bookings-test-'));
    const config = loadConfig({ NODE_ENV: 'test', ENABLE_LOCAL_DEMO: 'true', LOCAL_SESSION_SECRET: secret, PGLITE_DATA_DIR: directory });
    database = await openDatabase(config);
    const db = database;
    app = await buildApp({ config, database, logger: false });
    const request = (index: number | null, method: InjectOptions['method'], url: string, payload?: unknown, headers: Record<string, string> = {}) => app!.inject({
      method, url, headers: { ...(payload !== undefined ? { 'content-type': 'application/json' } : {}), ...headers, ...(index === null ? {} : { authorization: `Bearer ${token(index)}` }) },
      ...(payload !== undefined ? { payload: JSON.stringify(payload) } : {}),
    });
    let tripId = '';
    let activityId = '';
    let stayId = '';
    let segmentId = '';
    let activityBookingId = '';
    let stayBookingId = '';
    let travelBookingId = '';
    const url = () => `/v1/trips/${tripId}/bookings`;
    const bookingIds = async () => (await db.query<{ id: string }>('SELECT id FROM goa_core_bookings ORDER BY id')).map((row) => row.id);
    const liveFor = async (targetId: string) => db.query<{ id: string }>('SELECT id FROM goa_core_bookings WHERE target_id=$1 AND deleted_at IS NULL', [targetId]);

    await t.test('accepted members link one booking to an activity, a stay, and a travel segment', async () => {
      const created = await request(0, 'POST', '/v1/trips', tripInput);
      assert.equal(created.statusCode, 201, created.body);
      tripId = created.json().trip.id as string;
      const invitation = await request(0, 'POST', `/v1/trips/${tripId}/invitations`, { requiresApproval: false });
      assert.equal(invitation.statusCode, 201, invitation.body);
      const joined = await request(1, 'POST', '/v1/invitations/accept', { token: invitation.json().invitation.token });
      assert.equal(joined.statusCode, 200, joined.body);
      assert.equal(joined.json().status, 'accepted');

      const activity = await request(0, 'POST', `/v1/trips/${tripId}/activities`, { title: 'Chapora evening' });
      assert.equal(activity.statusCode, 201, activity.body);
      activityId = activity.json().activity.id as string;
      const stay = await request(0, 'POST', `/v1/trips/${tripId}/stays`, stayInput);
      assert.equal(stay.statusCode, 201, stay.body);
      stayId = stay.json().stay.id as string;
      const segment = await request(1, 'POST', `/v1/trips/${tripId}/travel`, travelInput);
      assert.equal(segment.statusCode, 201, segment.body);
      segmentId = segment.json().segment.id as string;

      const specs = [
        { actor: 0, targetType: 'activity', targetId: activityId, providerName: '  Coast Desk  ', reference: '  PAL-14  ', notes: 'Window table', createdBy: ids[0] },
        { actor: 0, targetType: 'stay', targetId: stayId, providerName: 'Palm House', reference: 'STAY-2', notes: '', createdBy: ids[0] },
        { actor: 1, targetType: 'travel', targetId: segmentId, providerName: 'IndiGo', reference: '6E221', notes: 'Aisle', createdBy: ids[1] },
      ] as const;
      const saved: Booking[] = [];
      for (const spec of specs) {
        const response = await request(spec.actor, 'POST', url(), {
          targetType: spec.targetType, targetId: spec.targetId, providerName: spec.providerName, reference: spec.reference, notes: spec.notes,
        });
        assert.equal(response.statusCode, 201, response.body);
        const booking = response.json().booking as Booking;
        saved.push(booking);
        assert.equal(booking.tripId, tripId);
        assert.equal(booking.targetType, spec.targetType);
        assert.equal(booking.targetId, spec.targetId);
        assert.equal(booking.providerName, spec.providerName.trim());
        assert.equal(booking.reference, spec.reference.trim());
        assert.equal(booking.notes, spec.notes);
        assert.equal(booking.createdBy, spec.createdBy);
        assert.equal('file' in booking, false);
        assert.match(booking.createdAt, /^\d{4}-\d{2}-\d{2}T/);
        const stored = await db.query<{ provider_name: string; reference: string }>('SELECT provider_name, reference FROM goa_core_bookings WHERE id=$1', [booking.id]);
        assert.equal(stored[0]!.provider_name, spec.providerName.trim());
        assert.equal(stored[0]!.reference, spec.reference.trim());
        const audit = await db.query<{ target_id: string; target_key: string | null }>('SELECT target_id, target_key FROM goa_core_audit WHERE trip_id=$1 AND action=$2 AND target_id=$3', [tripId, 'booking.created', booking.id]);
        assert.equal(audit.length, 1);
        assert.equal(audit[0]!.target_id, booking.id);
        assert.equal(audit[0]!.target_key, null);
        assert.equal((await db.query('SELECT id FROM goa_core_audit WHERE target_key=$1', [spec.reference.trim()])).length, 0);
      }
      activityBookingId = saved[0]!.id;
      stayBookingId = saved[1]!.id;
      travelBookingId = saved[2]!.id;
      const listed = (await request(0, 'GET', url())).json().bookings as Booking[];
      assert.deepEqual(listed.map((booking) => booking.id), [activityBookingId, stayBookingId, travelBookingId]);
      assertBookingOrder(listed);
      assert.deepEqual(listed.map((booking) => booking.targetType), ['activity', 'stay', 'travel']);
    });

    await t.test('a second live booking for the same target is a conflict and inserts nothing', async () => {
      const before = await bookingIds();
      const duplicate = await request(0, 'POST', url(), { targetType: 'activity', targetId: activityId, providerName: 'Other desk', reference: 'PAL-15' });
      assert.equal(duplicate.statusCode, 409, duplicate.body);
      assert.equal(duplicate.json().error.code, 'CONFLICT');
      assert.deepEqual(await bookingIds(), before);
      assert.equal((await liveFor(activityId)).length, 1);
      const stayDuplicate = await request(1, 'POST', url(), { targetType: 'stay', targetId: stayId, providerName: 'Another house', reference: 'STAY-9' });
      assert.equal(stayDuplicate.statusCode, 409, stayDuplicate.body);
      assert.equal((await liveFor(stayId)).length, 1);
      const travelDuplicate = await request(0, 'POST', url(), { targetType: 'travel', targetId: segmentId, providerName: 'Other air', reference: '6E999' });
      assert.equal(travelDuplicate.statusCode, 409, travelDuplicate.body);
      assert.equal((await liveFor(segmentId)).length, 1);
      assert.deepEqual(await bookingIds(), before);
    });

    await t.test('an activity from another trip or a removed activity is rejected before insert', async () => {
      const other = await request(0, 'POST', '/v1/trips', { ...tripInput, name: 'Other trip' });
      assert.equal(other.statusCode, 201, other.body);
      const otherTripId = other.json().trip.id as string;
      const foreignActivity = await request(0, 'POST', `/v1/trips/${otherTripId}/activities`, { title: 'Elsewhere' });
      assert.equal(foreignActivity.statusCode, 201, foreignActivity.body);
      const foreignActivityId = foreignActivity.json().activity.id as string;
      const before = await bookingIds();
      const rejected = await request(0, 'POST', url(), { targetType: 'activity', targetId: foreignActivityId, providerName: 'Wrong trip', reference: 'NO-1' });
      assert.equal(rejected.statusCode, 400, rejected.body);
      assert.equal(rejected.json().error.code, 'VALIDATION_ERROR');
      assert.deepEqual(await bookingIds(), before);
      assert.equal((await db.query('SELECT id FROM goa_core_bookings WHERE target_id=$1', [foreignActivityId])).length, 0);

      const closed = await request(0, 'POST', `/v1/trips/${tripId}/activities`, { title: 'Closed swim' });
      assert.equal(closed.statusCode, 201, closed.body);
      const closedId = closed.json().activity.id as string;
      assert.equal((await request(0, 'DELETE', `/v1/trips/${tripId}/activities/${closedId}`)).statusCode, 204);
      const closedBooking = await request(0, 'POST', url(), { targetType: 'activity', targetId: closedId, providerName: 'Closed desk', reference: 'CL-1' });
      assert.equal(closedBooking.statusCode, 400, closedBooking.body);
      assert.equal((await db.query('SELECT id FROM goa_core_bookings WHERE target_id=$1', [closedId])).length, 0);
      assert.equal((await db.query("SELECT id FROM goa_core_bookings WHERE provider_name='Closed desk'")).length, 0);
    });

    await t.test('the same retry key returns the original booking and a different body conflicts', async () => {
      const activity = await request(0, 'POST', `/v1/trips/${tripId}/activities`, { title: 'Retry plan' });
      assert.equal(activity.statusCode, 201, activity.body);
      const retryActivityId = activity.json().activity.id as string;
      const key = randomUUID();
      const body = { targetType: 'activity', targetId: retryActivityId, providerName: 'Retry Desk', reference: 'RPT-1', notes: 'Same card' };
      const repeated = await Promise.all([
        request(0, 'POST', url(), body, { 'idempotency-key': key }),
        request(0, 'POST', url(), body, { 'idempotency-key': key }),
      ]);
      assert.deepEqual(repeated.map((response) => response.statusCode), [201, 201], repeated.map((response) => response.body).join('\n'));
      assert.equal(repeated[0]!.json().booking.id, repeated[1]!.json().booking.id);
      assert.equal(repeated[0]!.json().booking.reference, 'RPT-1');
      const conflict = await request(0, 'POST', url(), { ...body, reference: 'RPT-2' }, { 'idempotency-key': key });
      assert.equal(conflict.statusCode, 409, conflict.body);
      assert.equal(conflict.json().error.code, 'CONFLICT');
      assert.equal((await db.query("SELECT id FROM goa_core_bookings WHERE target_id=$1 AND deleted_at IS NULL", [retryActivityId])).length, 1);
      assert.equal((await db.query("SELECT id FROM goa_core_bookings WHERE reference='RPT-2'")).length, 0);
    });

    await t.test('Dev, a pending member, and a removed member get the same unavailable response', async () => {
      const saved = (await request(0, 'GET', url())).json().bookings as Booking[];
      const hidden = async (index: number) => {
        const known = await request(index, 'GET', url());
        const unknown = await request(index, 'GET', `/v1/trips/${randomUUID()}/bookings`);
        assert.equal(known.statusCode, 404, known.body);
        assert.deepEqual(known.json(), unknown.json());
        assert.equal(known.json().error.code, 'NOT_FOUND');
        assert.equal(known.json().error.message, 'That resource is unavailable.');
        const before = await bookingIds();
        assert.equal((await request(index, 'POST', url(), { targetType: 'activity', targetId: activityId, providerName: 'Hidden desk', reference: 'HID-1' })).statusCode, 404);
        assert.equal((await request(index, 'PATCH', `${url()}/${activityBookingId}`, { targetType: 'activity', targetId: activityId, providerName: 'Hidden desk', reference: 'HID-1' })).statusCode, 404);
        assert.equal((await request(index, 'DELETE', `${url()}/${stayBookingId}`)).statusCode, 404);
        assert.deepEqual(await bookingIds(), before);
        assert.equal((await db.query("SELECT id FROM goa_core_bookings WHERE provider_name='Hidden desk'")).length, 0);
      };
      await hidden(2);
      const pendingInvite = await request(0, 'POST', `/v1/trips/${tripId}/invitations`, {});
      assert.equal(pendingInvite.statusCode, 201, pendingInvite.body);
      const pending = await request(2, 'POST', '/v1/invitations/accept', { token: pendingInvite.json().invitation.token });
      assert.equal(pending.json().status, 'pending');
      await hidden(2);
      assert.equal((await request(0, 'DELETE', `/v1/trips/${tripId}/members/${ids[1]}`)).statusCode, 204);
      await hidden(1);
      const removedMember = (await db.query<{ status: string; role: string }>('SELECT status, role FROM goa_core_memberships WHERE trip_id=$1 AND user_id=$2', [tripId, ids[1]]))[0]!;
      assert.equal(removedMember.status, 'removed');
      assert.equal(removedMember.role, 'member');
      const stillThere = (await request(0, 'GET', url())).json().bookings as Booking[];
      assert.deepEqual(stillThere, saved);
      assert.equal(stillThere.some((booking) => booking.id === travelBookingId), true);
    });

    await t.test('soft-delete hides the booking and a later booking can use that target', async () => {
      const patched = await request(0, 'PATCH', `${url()}/${activityBookingId}`, {
        targetType: 'activity', targetId: activityId, providerName: 'Coast Desk', reference: 'PAL-19', notes: 'Evening slot',
      });
      assert.equal(patched.statusCode, 200, patched.body);
      assert.equal(patched.json().booking.id, activityBookingId);
      assert.equal(patched.json().booking.reference, 'PAL-19');
      assert.equal(patched.json().booking.notes, 'Evening slot');
      const updated = await db.query<{ target_id: string; target_key: string | null }>('SELECT target_id, target_key FROM goa_core_audit WHERE trip_id=$1 AND action=$2 AND target_id=$3', [tripId, 'booking.updated', activityBookingId]);
      assert.equal(updated.length, 1);
      assert.equal(updated[0]!.target_id, activityBookingId);
      assert.equal(updated[0]!.target_key, null);
      assert.equal((await db.query('SELECT id FROM goa_core_audit WHERE target_key=$1', ['PAL-19'])).length, 0);

      assert.equal((await request(0, 'DELETE', `${url()}/${activityBookingId}`, { reference: 'PAL-19' })).statusCode, 400);
      assert.equal((await liveFor(activityId)).length, 1);
      assert.equal((await request(0, 'DELETE', `${url()}/${activityBookingId}`)).statusCode, 204);
      const visible = (await request(0, 'GET', url())).json().bookings as Booking[];
      assert.equal(visible.some((booking) => booking.id === activityBookingId), false);
      assert.equal(visible.some((booking) => booking.id === stayBookingId), true);
      assertBookingOrder(visible);
      assert.equal((await db.query('SELECT id FROM goa_core_bookings WHERE id=$1 AND deleted_at IS NOT NULL', [activityBookingId])).length, 1);
      const deletedAudit = await db.query<{ target_id: string; target_key: string | null }>('SELECT target_id, target_key FROM goa_core_audit WHERE action=$1 AND target_id=$2', ['booking.deleted', activityBookingId]);
      assert.equal(deletedAudit.length, 1);
      assert.equal(deletedAudit[0]!.target_id, activityBookingId);
      assert.equal(deletedAudit[0]!.target_key, null);
      assert.equal((await request(0, 'PATCH', `${url()}/${activityBookingId}`, { targetType: 'activity', targetId: activityId, providerName: 'Coast Desk', reference: 'PAL-19' })).statusCode, 404);
      assert.equal((await request(0, 'DELETE', `${url()}/${activityBookingId}`)).statusCode, 404);

      const replacement = await request(0, 'POST', url(), { targetType: 'activity', targetId: activityId, providerName: 'Coast Desk', reference: 'PAL-20' });
      assert.equal(replacement.statusCode, 201, replacement.body);
      assert.notEqual(replacement.json().booking.id, activityBookingId);
      assert.equal(replacement.json().booking.targetId, activityId);
      assert.equal((await liveFor(activityId)).length, 1);
      assert.equal((await db.query('SELECT id FROM goa_core_bookings WHERE target_id=$1', [activityId])).length, 2);
      const after = (await request(0, 'GET', url())).json().bookings as Booking[];
      assert.equal(after.some((booking) => booking.id === replacement.json().booking.id), true);
      assert.equal(after.some((booking) => booking.id === activityBookingId), false);
      assertBookingOrder(after);
    });

    await t.test('the bookings table has no file column and a file property is rejected', async () => {
      const columns = await db.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name='goa_core_bookings'");
      const names = columns.map((column) => column.column_name);
      assert.equal(names.includes('reference'), true);
      assert.equal(names.includes('provider_name'), true);
      assert.equal(names.includes('file'), false);
      const probe = await request(0, 'POST', `/v1/trips/${tripId}/activities`, { title: 'File probe' });
      assert.equal(probe.statusCode, 201, probe.body);
      const probeId = probe.json().activity.id as string;
      const before = await bookingIds();
      const rejected = await request(0, 'POST', url(), { targetType: 'activity', targetId: probeId, providerName: 'Desk', reference: 'FILE-1', file: 'ticket.pdf' });
      assert.equal(rejected.statusCode, 400, rejected.body);
      assert.equal(rejected.json().error.code, 'VALIDATION_ERROR');
      const patched = await request(0, 'PATCH', `${url()}/${stayBookingId}`, {
        targetType: 'stay', targetId: stayId, providerName: 'Palm House', reference: 'STAY-2', file: 'stay.pdf',
      });
      assert.equal(patched.statusCode, 400, patched.body);
      assert.deepEqual(await bookingIds(), before);
      assert.equal((await db.query('SELECT id FROM goa_core_bookings WHERE target_id=$1', [probeId])).length, 0);
      const stayRow = await db.query<{ reference: string }>('SELECT reference FROM goa_core_bookings WHERE id=$1', [stayBookingId]);
      assert.equal(stayRow[0]!.reference, 'STAY-2');
    });
  } finally {
    if (app) await app.close();
    if (database) await database.close();
    if (directory) {
      assert.ok(resolve(directory).startsWith(resolve(testRoot) + sep));
      await rm(directory, { recursive: true, force: true });
    }
  }
});
