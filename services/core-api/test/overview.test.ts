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
import type { Activity } from '../src/types.js';
import type { Contact, Stay, TravelSegment, TripOverview } from '../src/trip-planning-types.js';

const secret = 'overview-synthetic-test-secret-with-32-bytes';
const ids = ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003'];
function token(index: number): string {
  const encoded = Buffer.from(JSON.stringify({ sub: ids[index], displayName: ['Aman', 'Riya', 'Dev'][index], email: ['aman', 'riya', 'dev'][index] + '@example.invalid', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  return `local.${encoded}.${createHmac('sha256', secret).update(`local.${encoded}`).digest('base64url')}`;
}

function addDays(day: string, count: number): string {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, date! + count)).toISOString().slice(0, 10);
}

test('accepted members read today, upcoming travel, stays, and contacts', async () => {
  const testRoot = fileURLToPath(new URL('../../../.data/tests/', import.meta.url));
  await mkdir(testRoot, { recursive: true });
  const directory = await mkdtemp(join(testRoot, 'goa-overview-test-'));
  const config = loadConfig({ NODE_ENV: 'test', ENABLE_LOCAL_DEMO: 'true', LOCAL_SESSION_SECRET: secret, PGLITE_DATA_DIR: directory });
  const database = await openDatabase(config);
  let app: FastifyInstance | undefined;
  try {
    await migrate(database);
    const todayRow = await database.query<{ today: string }>(`SELECT ((now() AT TIME ZONE 'Asia/Kolkata')::date)::text AS today`);
    const today = String(todayRow[0]!.today).slice(0, 10);
    assert.match(today, /^\d{4}-\d{2}-\d{2}$/);
    app = await buildApp({ config, database, runMigrations: false, logger: false });
    const request = (index: number | null, method: InjectOptions['method'], url: string, payload?: unknown, headers: Record<string, string> = {}) => app!.inject({
      method, url, headers: { ...(payload !== undefined ? { 'content-type': 'application/json' } : {}), ...headers, ...(index === null ? {} : { authorization: `Bearer ${token(index)}` }) },
      ...(payload !== undefined ? { payload: JSON.stringify(payload) } : {}),
    });

    const created = await request(0, 'POST', '/v1/trips', { name: 'Goa together', startDate: today, endDate: addDays(today, 14) });
    assert.equal(created.statusCode, 201, created.body);
    const tripId = created.json().trip.id as string;
    const overviewUrl = `/v1/trips/${tripId}/overview`;

    const invitation = await request(0, 'POST', `/v1/trips/${tripId}/invitations`, { requiresApproval: true });
    assert.equal(invitation.statusCode, 201, invitation.body);
    const accepted = await request(1, 'POST', '/v1/invitations/accept', { token: invitation.json().invitation.token });
    assert.equal(accepted.statusCode, 200, accepted.body);
    assert.equal(accepted.json().status, 'pending');
    const pendingRead = await request(1, 'GET', overviewUrl);
    assert.equal(pendingRead.statusCode, 404);
    assert.equal(pendingRead.json().error.code, 'NOT_FOUND');
    assert.equal(pendingRead.json().error.message, 'That resource is unavailable.');

    const approved = await request(0, 'POST', `/v1/trips/${tripId}/members/${ids[1]}/approve`);
    assert.equal(approved.statusCode, 200, approved.body);

    const swimResponse = await request(0, 'POST', `/v1/trips/${tripId}/activities`, {
      title: 'Morning swim', day: today, startTime: '09:00', endTime: '11:00', location: 'Baga beach',
    });
    assert.equal(swimResponse.statusCode, 201, swimResponse.body);
    const swim = swimResponse.json().activity as Activity;
    const statusRows = await database.query<{ count: number | string }>('SELECT count(*)::int AS count FROM goa_core_activity_status WHERE activity_id=$1', [swim.id]);
    assert.equal(Number(statusRows[0]!.count), 0);

    const droppedResponse = await request(0, 'POST', `/v1/trips/${tripId}/activities`, {
      title: 'Beach game', day: today, startTime: '15:00', endTime: '16:00', location: 'Baga beach',
    });
    assert.equal(droppedResponse.statusCode, 201, droppedResponse.body);
    const dropped = droppedResponse.json().activity as Activity;
    const cancelled = await request(0, 'PUT', `/v1/trips/${tripId}/activities/${dropped.id}/status`, { status: 'cancelled' });
    assert.equal(cancelled.statusCode, 200, cancelled.body);
    assert.equal(cancelled.json().status, 'cancelled');

    const flightResponse = await request(0, 'POST', `/v1/trips/${tripId}/travel`, {
      mode: 'flight',
      title: 'Mumbai to Goa',
      departurePlace: 'Mumbai airport',
      arrivalPlace: 'Goa airport',
      departureAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      travellerIds: [],
    });
    assert.equal(flightResponse.statusCode, 201, flightResponse.body);
    const flight = flightResponse.json().segment as TravelSegment;
    const pastResponse = await request(0, 'POST', `/v1/trips/${tripId}/travel`, {
      mode: 'train',
      title: 'Train already gone',
      departurePlace: 'Mumbai',
      arrivalPlace: 'Madgaon',
      departureAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      travellerIds: [],
    });
    assert.equal(pastResponse.statusCode, 201, pastResponse.body);
    const past = pastResponse.json().segment as TravelSegment;

    const stayResponse = await request(0, 'POST', `/v1/trips/${tripId}/stays`, {
      propertyName: 'Casa Baga',
      checkIn: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
      checkOut: new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString(),
      guestIds: [],
    });
    assert.equal(stayResponse.statusCode, 201, stayResponse.body);
    const currentStay = stayResponse.json().stay as Stay;
    const laterResponse = await request(0, 'POST', `/v1/trips/${tripId}/stays`, {
      propertyName: 'Later house',
      checkIn: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString(),
      checkOut: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString(),
      guestIds: [],
    });
    assert.equal(laterResponse.statusCode, 201, laterResponse.body);
    const laterStay = laterResponse.json().stay as Stay;
    const endedResponse = await request(0, 'POST', `/v1/trips/${tripId}/stays`, {
      propertyName: 'Already left',
      checkIn: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      checkOut: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      guestIds: [],
    });
    assert.equal(endedResponse.statusCode, 201, endedResponse.body);
    const endedStay = endedResponse.json().stay as Stay;

    const contactResponse = await request(0, 'POST', `/v1/trips/${tripId}/contacts`, {
      role: 'driver',
      name: 'Raju',
      phone: '+91 83200 11111',
    });
    assert.equal(contactResponse.statusCode, 201, contactResponse.body);
    const contact = contactResponse.json().contact as Contact;

    const overviewResponse = await request(0, 'GET', overviewUrl);
    assert.equal(overviewResponse.statusCode, 200, overviewResponse.body);
    const overview = overviewResponse.json() as TripOverview;
    assert.deepEqual(Object.keys(overview).sort(), ['contacts', 'stays', 'today', 'upcomingTravel']);
    assert.equal('weather' in overview, false);
    assert.equal('reminders' in overview, false);

    assert.deepEqual(overview.today, [{
      id: swim.id,
      tripId: swim.tripId,
      title: swim.title,
      day: swim.day,
      startTime: swim.startTime,
      endTime: swim.endTime,
      location: swim.location,
      status: 'planned',
    }]);
    assert.equal(overview.today.some((item) => item.id === dropped.id), false);

    const activities = await request(0, 'GET', `/v1/trips/${tripId}/activities`);
    assert.equal(activities.statusCode, 200, activities.body);
    const activityIds = (activities.json().activities as Activity[]).map((item) => item.id);
    assert.ok(activityIds.includes(swim.id));
    assert.ok(activityIds.includes(dropped.id));

    const travelList = await request(0, 'GET', `/v1/trips/${tripId}/travel`);
    assert.equal(travelList.statusCode, 200, travelList.body);
    const listedFlight = (travelList.json().segments as TravelSegment[]).find((item) => item.id === flight.id);
    assert.deepEqual(overview.upcomingTravel.map((item) => item.id), [flight.id]);
    assert.equal(overview.upcomingTravel.some((item) => item.id === past.id), false);
    assert.deepEqual(overview.upcomingTravel[0], listedFlight);

    const stayList = await request(0, 'GET', `/v1/trips/${tripId}/stays`);
    assert.equal(stayList.statusCode, 200, stayList.body);
    const stays = stayList.json().stays as Stay[];
    assert.deepEqual(overview.stays.map((item) => item.id), [currentStay.id, laterStay.id]);
    assert.equal(overview.stays.some((item) => item.id === endedStay.id), false);
    assert.deepEqual(overview.stays[0], stays.find((item) => item.id === currentStay.id));
    assert.deepEqual(overview.stays[1], stays.find((item) => item.id === laterStay.id));

    const contactList = await request(0, 'GET', `/v1/trips/${tripId}/contacts`);
    assert.equal(contactList.statusCode, 200, contactList.body);
    const listedContact = (contactList.json().contacts as Contact[]).find((item) => item.id === contact.id);
    assert.deepEqual(overview.contacts, [listedContact]);

    const devRead = await request(2, 'GET', overviewUrl);
    const unknownRead = await request(2, 'GET', `/v1/trips/${randomUUID()}/overview`);
    assert.equal(devRead.statusCode, 404);
    assert.equal(devRead.json().error.message, 'That resource is unavailable.');
    assert.deepEqual(devRead.json(), unknownRead.json());

    const removed = await request(0, 'DELETE', `/v1/trips/${tripId}/members/${ids[1]}`);
    assert.equal(removed.statusCode, 204, removed.body);
    const removedRead = await request(1, 'GET', overviewUrl);
    assert.equal(removedRead.statusCode, 404);
    assert.equal(removedRead.json().error.code, 'NOT_FOUND');
    assert.equal(removedRead.json().error.message, 'That resource is unavailable.');
    const stillThere = await request(0, 'GET', overviewUrl);
    assert.equal(stillThere.statusCode, 200, stillThere.body);
    assert.equal((stillThere.json() as TripOverview).today[0]?.id, swim.id);

    const quiet = await request(0, 'POST', '/v1/trips', { name: 'Quiet days', startDate: today, endDate: addDays(today, 3) });
    assert.equal(quiet.statusCode, 201, quiet.body);
    const emptyOverview = await request(0, 'GET', `/v1/trips/${quiet.json().trip.id}/overview`);
    assert.equal(emptyOverview.statusCode, 200, emptyOverview.body);
    assert.deepEqual(emptyOverview.json(), { today: [], upcomingTravel: [], stays: [], contacts: [] });
  } finally {
    if (app) await app.close();
    await database.close();
    assert.ok(resolve(directory).startsWith(resolve(testRoot) + sep));
    await rm(directory, { recursive: true, force: true });
  }
});
