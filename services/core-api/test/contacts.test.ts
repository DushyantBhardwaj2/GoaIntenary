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
import type { Contact, ContactRole } from '../src/trip-planning-types.js';

const secret = 'contacts-synthetic-test-secret-with-32-bytes';
const ids = ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003'];
function token(index: number): string {
  const encoded = Buffer.from(JSON.stringify({ sub: ids[index], displayName: ['Aman', 'Riya', 'Dev'][index], email: ['aman', 'riya', 'dev'][index] + '@example.invalid', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  return `local.${encoded}.${createHmac('sha256', secret).update(`local.${encoded}`).digest('base64url')}`;
}
const tripInput = { name: 'Contact cards', startDate: '2026-12-04', endDate: '2026-12-06', region: 'north', travellerCount: 4, budgetPaise: 2_000_000, styles: ['beaches'] };

test('phone cards stay on the trip and do not change membership roles', async (t) => {
  const testRoot = fileURLToPath(new URL('../../../.data/tests/', import.meta.url));
  await mkdir(testRoot, { recursive: true });
  const directory = await mkdtemp(join(testRoot, 'goa-contacts-test-'));
  const config = loadConfig({ NODE_ENV: 'test', ENABLE_LOCAL_DEMO: 'true', LOCAL_SESSION_SECRET: secret, PGLITE_DATA_DIR: directory });
  const database = await openDatabase(config);
  let app: FastifyInstance | undefined;
  try {
    app = await buildApp({ config, database, logger: false });
    const request = (index: number | null, method: InjectOptions['method'], url: string, payload?: unknown, headers: Record<string, string> = {}) => app!.inject({
      method, url, headers: { ...(payload !== undefined ? { 'content-type': 'application/json' } : {}), ...headers, ...(index === null ? {} : { authorization: `Bearer ${token(index)}` }) },
      ...(payload !== undefined ? { payload: JSON.stringify(payload) } : {}),
    });
    let tripId = '';
    let otherTripId = '';
    let hotelId = '';
    let organiserId = '';
    let rentalId = '';
    const url = () => `/v1/trips/${tripId}/contacts`;

    await t.test('accepted members save one card of each role without changing membership', async () => {
      const created = await request(0, 'POST', '/v1/trips', tripInput);
      assert.equal(created.statusCode, 201, created.body);
      tripId = created.json().trip.id as string;
      const invitation = await request(0, 'POST', `/v1/trips/${tripId}/invitations`, { requiresApproval: false });
      assert.equal(invitation.statusCode, 201, invitation.body);
      const joined = await request(1, 'POST', '/v1/invitations/accept', { token: invitation.json().invitation.token });
      assert.equal(joined.statusCode, 200, joined.body);
      assert.equal(joined.json().status, 'accepted');
      const before = await database.query<{ user_id: string; role: string }>('SELECT user_id, role FROM goa_core_memberships WHERE trip_id=$1 ORDER BY user_id', [tripId]);

      const specs: { role: ContactRole; name: string; phone?: string; actor: number }[] = [
        { role: 'rental', name: '  Scoot Goa  ', phone: '123456', actor: 0 },
        { role: 'organiser', name: 'Desk Aman', phone: '8324444', actor: 1 },
        { role: 'hotel', name: 'Casa Palms', phone: '+91-832-333-3333', actor: 0 },
        { role: 'driver', name: 'Ravi', phone: '0832 222 2222', actor: 0 },
        { role: 'activity_provider', name: 'Boat desk', phone: '+91 832 111 1111', actor: 0 },
        { role: 'hotel', name: 'Alpha Inn', actor: 0 },
      ];
      const saved = new Map<string, Contact>();
      for (const spec of specs) {
        const response = await request(spec.actor, 'POST', url(), { role: spec.role, name: spec.name, ...(spec.phone !== undefined ? { phone: spec.phone } : {}) });
        assert.equal(response.statusCode, 201, response.body);
        const contact = response.json().contact as Contact;
        saved.set(spec.role === 'hotel' && spec.name === 'Alpha Inn' ? 'alpha' : spec.role, contact);
        assert.equal(contact.tripId, tripId);
        assert.equal(contact.role, spec.role);
        assert.equal(contact.stayId, null);
        assert.equal(contact.activityId, null);
        assert.equal(contact.note, '');
        assert.equal(contact.createdBy, ids[spec.actor]);
        assert.match(contact.createdAt, /^\d{4}-\d{2}-\d{2}T/);
        const audit = await database.query<{ target_id: string; target_key: string | null }>('SELECT target_id, target_key FROM goa_core_audit WHERE trip_id=$1 AND action=$2 AND target_id=$3', [tripId, 'contact.created', contact.id]);
        assert.equal(audit.length, 1);
        assert.equal(audit[0]!.target_key, null);
      }
      const organiser = saved.get('organiser')!;
      const rental = saved.get('rental')!;
      hotelId = saved.get('hotel')!.id;
      organiserId = organiser.id;
      rentalId = rental.id;
      assert.equal(organiser.name, 'Desk Aman');
      assert.equal(organiser.phone, '8324444');
      assert.equal(rental.name, 'Scoot Goa');
      assert.equal(rental.phone, '123456');
      assert.equal(saved.get('alpha')!.phone, '');
      assert.equal(saved.get('activity_provider')!.phone, '+91 832 111 1111');

      const after = await database.query<{ user_id: string; role: string }>('SELECT user_id, role FROM goa_core_memberships WHERE trip_id=$1 ORDER BY user_id', [tripId]);
      assert.deepEqual(after, before);
      assert.deepEqual(after.map((row) => row.role), ['organiser', 'member']);
      assert.equal((await request(1, 'GET', `/v1/trips/${tripId}`)).json().trip.role, 'member');

      const listed = (await request(0, 'GET', url())).json().contacts as Contact[];
      assert.deepEqual(listed.map((contact) => contact.role), ['activity_provider', 'driver', 'hotel', 'hotel', 'organiser', 'rental']);
      assert.deepEqual(listed.map((contact) => contact.name), ['Boat desk', 'Ravi', 'Alpha Inn', 'Casa Palms', 'Desk Aman', 'Scoot Goa']);
      assert.deepEqual(listed.filter((contact) => contact.role === 'hotel').map((contact) => contact.id), [saved.get('alpha')!.id, hotelId]);
    });

    await t.test('unknown roles, blank names, and reused retry keys stay safe', async () => {
      const unknown = await request(0, 'POST', url(), { role: 'guide', name: 'Someone' });
      assert.equal(unknown.statusCode, 400, unknown.body);
      assert.equal(unknown.json().error.code, 'VALIDATION_ERROR');
      const before = (await database.query('SELECT id FROM goa_core_contacts WHERE trip_id=$1', [tripId])).length;
      const blank = await request(0, 'POST', url(), { role: 'hotel', name: '   ' });
      assert.equal(blank.statusCode, 400, blank.body);
      assert.equal(blank.json().error.message, 'Give the contact a name.');
      assert.equal((await database.query('SELECT id FROM goa_core_contacts WHERE trip_id=$1', [tripId])).length, before);

      const key = randomUUID();
      const body = { role: 'driver', name: 'Night driver', phone: '9000000000' };
      const repeated = await Promise.all([
        request(0, 'POST', url(), body, { 'idempotency-key': key }),
        request(0, 'POST', url(), body, { 'idempotency-key': key }),
      ]);
      assert.deepEqual(repeated.map((response) => response.statusCode), [201, 201], repeated.map((response) => response.body).join('\n'));
      assert.equal(repeated[0]!.json().contact.id, repeated[1]!.json().contact.id);
      const conflict = await request(0, 'POST', url(), { ...body, name: 'Other driver' }, { 'idempotency-key': key });
      assert.equal(conflict.statusCode, 409, conflict.body);
      assert.equal((await database.query("SELECT id FROM goa_core_contacts WHERE trip_id=$1 AND name='Night driver'", [tripId])).length, 1);
      assert.equal((await database.query("SELECT id FROM goa_core_contacts WHERE name='Other driver'")).length, 0);
    });

    await t.test('a stay or activity from another trip is rejected before insert', async () => {
      const other = await request(0, 'POST', '/v1/trips', { ...tripInput, name: 'Other trip' });
      assert.equal(other.statusCode, 201, other.body);
      otherTripId = other.json().trip.id as string;
      const foreignStay = randomUUID();
      await database.query(`INSERT INTO goa_core_stays (id, trip_id, property_name, check_in, check_out, created_by)
        VALUES ($1,$2,'Other house',$3,$4,$5)`, [foreignStay, otherTripId, '2026-12-04T14:00:00.000Z', '2026-12-06T11:00:00.000Z', ids[0]]);
      const contactIds = async () => (await database.query<{ id: string }>('SELECT id FROM goa_core_contacts')).map((row) => row.id).sort();
      const before = await contactIds();
      const rejected = await request(0, 'POST', url(), { role: 'hotel', name: 'Wrong stay', stayId: foreignStay });
      assert.equal(rejected.statusCode, 400, rejected.body);
      assert.equal(rejected.json().error.code, 'VALIDATION_ERROR');
      assert.deepEqual(await contactIds(), before);
      assert.equal((await database.query('SELECT id FROM goa_core_contacts WHERE stay_id=$1', [foreignStay])).length, 0);

      const homeStay = randomUUID();
      await database.query(`INSERT INTO goa_core_stays (id, trip_id, property_name, check_in, check_out, created_by)
        VALUES ($1,$2,'Palm House',$3,$4,$5)`, [homeStay, tripId, '2026-12-04T14:00:00.000Z', '2026-12-06T11:00:00.000Z', ids[0]]);
      const linked = await request(0, 'POST', url(), { role: 'hotel', name: 'Palm desk', stayId: homeStay });
      assert.equal(linked.statusCode, 201, linked.body);
      assert.equal(linked.json().contact.stayId, homeStay);
      const removedStay = randomUUID();
      await database.query(`INSERT INTO goa_core_stays (id, trip_id, property_name, check_in, check_out, created_by, deleted_at)
        VALUES ($1,$2,'Closed house',$3,$4,$5,now())`, [removedStay, tripId, '2026-12-04T14:00:00.000Z', '2026-12-06T11:00:00.000Z', ids[0]]);
      const closed = await request(0, 'POST', url(), { role: 'hotel', name: 'Closed desk', stayId: removedStay });
      assert.equal(closed.statusCode, 400, closed.body);
      assert.equal((await database.query("SELECT id FROM goa_core_contacts WHERE name='Closed desk'")).length, 0);

      const foreignActivityResponse = await request(0, 'POST', `/v1/trips/${otherTripId}/activities`, { title: 'Elsewhere' });
      assert.equal(foreignActivityResponse.statusCode, 201, foreignActivityResponse.body);
      const foreignActivity = foreignActivityResponse.json().activity.id as string;
      const foreignCard = await request(0, 'POST', url(), { role: 'activity_provider', name: 'Foreign activity', activityId: foreignActivity });
      assert.equal(foreignCard.statusCode, 400, foreignCard.body);
      assert.equal((await database.query('SELECT id FROM goa_core_contacts WHERE activity_id=$1', [foreignActivity])).length, 0);
      const activity = await request(0, 'POST', `/v1/trips/${tripId}/activities`, { title: 'Spice walk' });
      assert.equal(activity.statusCode, 201, activity.body);
      const activityId = activity.json().activity.id as string;
      const linkedActivity = await request(0, 'POST', url(), { role: 'activity_provider', name: 'Spice desk', activityId });
      assert.equal(linkedActivity.statusCode, 201, linkedActivity.body);
      assert.equal(linkedActivity.json().contact.activityId, activityId);
      assert.equal((await request(0, 'DELETE', `/v1/trips/${tripId}/activities/${activityId}`)).statusCode, 204);
      const retired = await request(0, 'POST', url(), { role: 'activity_provider', name: 'Spice desk again', activityId });
      assert.equal(retired.statusCode, 400, retired.body);
      assert.equal((await database.query("SELECT id FROM goa_core_contacts WHERE name='Spice desk again'")).length, 0);
    });

    await t.test('outsider, pending, and removed members receive the same unavailable response', async () => {
      const hidden = async (index: number) => {
        const known = await request(index, 'GET', url());
        const unknown = await request(index, 'GET', `/v1/trips/${randomUUID()}/contacts`);
        assert.equal(known.statusCode, 404, known.body);
        assert.deepEqual(known.json(), unknown.json());
        assert.equal(known.json().error.code, 'NOT_FOUND');
        assert.equal((await request(index, 'POST', url(), { role: 'driver', name: 'Hidden person' })).statusCode, 404);
        assert.equal((await request(index, 'PATCH', `${url()}/${hotelId}`, { role: 'hotel', name: 'Hidden person' })).statusCode, 404);
        assert.equal((await request(index, 'DELETE', `${url()}/${hotelId}`)).statusCode, 404);
      };
      await hidden(2);
      const pendingInvite = await request(0, 'POST', `/v1/trips/${tripId}/invitations`, {});
      assert.equal(pendingInvite.statusCode, 201, pendingInvite.body);
      const pending = await request(2, 'POST', '/v1/invitations/accept', { token: pendingInvite.json().invitation.token });
      assert.equal(pending.json().status, 'pending');
      await hidden(2);
      assert.equal((await request(0, 'DELETE', `/v1/trips/${tripId}/members/${ids[1]}`)).statusCode, 204);
      await hidden(1);
      const removedMember = (await database.query<{ role: string; status: string }>('SELECT role, status FROM goa_core_memberships WHERE trip_id=$1 AND user_id=$2', [tripId, ids[1]]))[0]!;
      assert.equal(removedMember.status, 'removed');
      assert.equal(removedMember.role, 'member');
      const stillThere = (await request(0, 'GET', url())).json().contacts as Contact[];
      assert.equal(stillThere.some((contact) => contact.id === organiserId), true);
      assert.equal((await database.query<{ role: string }>('SELECT role FROM goa_core_memberships WHERE trip_id=$1 AND user_id=$2', [tripId, ids[0]]))[0]!.role, 'organiser');
      assert.equal((await database.query("SELECT id FROM goa_core_contacts WHERE name='Hidden person'")).length, 0);
    });

    await t.test('soft-delete hides the card and further edits are unavailable', async () => {
      const patched = await request(0, 'PATCH', `${url()}/${hotelId}`, { role: 'hotel', name: 'Casa Palms', phone: '0832 333 0000', note: 'Garden room', stayId: null, activityId: null });
      assert.equal(patched.statusCode, 200, patched.body);
      assert.equal(patched.json().contact.id, hotelId);
      assert.equal(patched.json().contact.phone, '0832 333 0000');
      assert.equal(patched.json().contact.note, 'Garden room');
      const updated = await database.query<{ target_key: string | null }>('SELECT target_key FROM goa_core_audit WHERE trip_id=$1 AND action=$2 AND target_id=$3', [tripId, 'contact.updated', hotelId]);
      assert.equal(updated.length, 1);
      assert.equal(updated[0]!.target_key, null);
      const blank = await request(0, 'PATCH', `${url()}/${hotelId}`, { role: 'hotel', name: '   ' });
      assert.equal(blank.statusCode, 400, blank.body);
      assert.equal((await request(0, 'GET', url())).json().contacts.find((contact: Contact) => contact.id === hotelId).name, 'Casa Palms');

      assert.equal((await request(0, 'DELETE', `${url()}/${rentalId}`, { name: 'nope' })).statusCode, 400);
      assert.equal((await request(0, 'DELETE', `${url()}/${rentalId}`)).statusCode, 204);
      const visible = (await request(0, 'GET', url())).json().contacts as Contact[];
      assert.equal(visible.some((contact) => contact.id === rentalId), false);
      assert.equal((await database.query('SELECT id FROM goa_core_contacts WHERE id=$1 AND deleted_at IS NOT NULL', [rentalId])).length, 1);
      const deletedAudit = await database.query<{ target_key: string | null }>('SELECT target_key FROM goa_core_audit WHERE action=$1 AND target_id=$2', ['contact.deleted', rentalId]);
      assert.equal(deletedAudit.length, 1);
      assert.equal(deletedAudit[0]!.target_key, null);
      assert.equal((await request(0, 'PATCH', `${url()}/${rentalId}`, { role: 'rental', name: 'Scoot Goa' })).statusCode, 404);
      assert.equal((await request(0, 'DELETE', `${url()}/${rentalId}`)).statusCode, 404);
      const missing = randomUUID();
      assert.equal((await request(0, 'PATCH', `${url()}/${missing}`, { role: 'driver', name: 'Nobody' })).statusCode, 404);
      assert.equal((await request(0, 'DELETE', `${url()}/${missing}`)).statusCode, 404);
    });
  } finally {
    if (app) await app.close();
    await database.close();
    assert.ok(resolve(directory).startsWith(resolve(testRoot) + sep));
    await rm(directory, { recursive: true, force: true });
  }
});
