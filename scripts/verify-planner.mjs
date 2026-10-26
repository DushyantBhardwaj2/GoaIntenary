import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const target = new URL(process.env.GOA_WEB_URL || 'http://127.0.0.1:3000');
if (target.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(target.hostname)) throw new Error('Planner verification only writes to local synthetic environments.');
const origin = target.origin;
let groups = 0;
function pass(name) { groups++; console.log(`PASS ${name}`); }
async function call(route, method = 'GET', body, cookie, extra = {}) {
  const response = await fetch(new URL(route, origin), {
    method, redirect: 'manual', signal: AbortSignal.timeout(30000),
    headers: { ...(method !== 'GET' ? { Origin: origin } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...extra },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, data: response.status === 204 ? null : await response.json(), response };
}
assert.equal((await call('/api/auth/status')).data.localAvailable, true, 'Run npm run dev:local first.');
async function login(account) {
  const result = await call('/api/auth/local', 'POST', { account });
  assert.equal(result.status, 200);
  const cookie = result.response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const profile = await call('/api/core/v1/me', 'GET', undefined, cookie);
  assert.equal(profile.status, 200);
  return { cookie, user: profile.data.user };
}
const [organiser, member, outsider] = await Promise.all(['aman', 'riya', 'dev'].map(login));
const catalogue = await call('/api/discovery/places');
assert.equal(catalogue.status, 200);
assert.ok(catalogue.data.places.length >= 12);
assert.equal(catalogue.data.catalogue.kind, 'curated');
for (const place of catalogue.data.places) {
  assert.ok(place.sourceUrl.startsWith('https://'));
  assert.ok(Number.isFinite(Date.parse(place.checkedAt)));
  assert.ok(Number.isFinite(place.latitude) && Number.isFinite(place.longitude));
}
const source = catalogue.data.places[0];
const filtered = await call(`/api/discovery/places?q=${encodeURIComponent(source.title)}&region=${source.region}&category=${source.category}`);
assert.equal(filtered.status, 200);
assert.ok(filtered.data.places.some(place => place.id === source.id));
assert.equal((await call('/api/discovery/places?region=not-goa')).status, 400);
assert.equal((await call('/api/discovery/places?q=no-such-place-xyz')).data.total, 0);
pass('Public discovery has sourced records, filters, empty and invalid states');

const creation = await call('/api/core/v1/trips', 'POST', {
  name: 'Planner verification · Goa Together', startDate: '2026-12-04', endDate: '2026-12-06',
  description: 'Synthetic planner fixture', region: 'south', travellerCount: 4, budgetPaise: 2000000, styles: ['beaches', 'food'],
}, organiser.cookie, { 'Idempotency-Key': randomUUID() });
assert.equal(creation.status, 201);
const tripId = creation.data.trip.id, base = `/api/core/v1/trips/${tripId}`;
assert.equal(creation.data.trip.travellerCount, 4);
assert.equal(creation.data.trip.acceptedMemberCount, 1);
const updated = await call(base, 'PATCH', { name: 'A saved Goa weekend', region: 'all' }, organiser.cookie);
assert.equal(updated.status, 200);
assert.equal((await call(base, 'GET', undefined, organiser.cookie)).data.trip.name, 'A saved Goa weekend');
pass('Extended trip creation, settings edit and reopen use persistent server data');
const invitation = await call(`${base}/invitations`, 'POST', {}, organiser.cookie);
assert.equal(invitation.status, 201);
const token = invitation.data.invitation.token;
assert.equal((await call('/api/core/v1/invitations/accept', 'POST', { token }, member.cookie)).data.status, 'pending');
assert.equal((await call(`${base}/activities`, 'GET', undefined, member.cookie)).status, 404);
assert.equal((await call(`${base}/members/${member.user.id}/approve`, 'POST', {}, organiser.cookie)).status, 200);
assert.equal((await call(base, 'PATCH', { budgetPaise: 1 }, member.cookie)).status, 403);
pass('New planner resources preserve pending/member/organiser boundaries');

const makeActivity = (title, day, estimatedCostPaise = 0) => call(`${base}/activities`, 'POST', {
  title, day, estimatedCostPaise, startTime: '09:00', endTime: '10:00', category: 'beach',
  description: 'A manually added stop', location: 'Goa', notes: 'Carry water', meetingPoint: 'By the main entrance',
}, member.cookie, { 'Idempotency-Key': randomUUID() });
const first = await makeActivity('A long morning by the sea', '2026-12-04', 800000);
const second = await makeActivity('An unhurried lunch', '2026-12-04');
assert.equal(first.status, 201); assert.equal(second.status, 201);
assert.equal((await makeActivity('Outside date', '2027-01-01')).status, 400);
const order = await call(`${base}/activities/reorder`, 'POST', { day: '2026-12-04', activityIds: [second.data.activity.id, first.data.activity.id] }, member.cookie);
assert.equal(order.status, 200);
assert.deepEqual(order.data.activities.map(item => item.id), [second.data.activity.id, first.data.activity.id]);
let activities = (await call(`${base}/activities`, 'GET', undefined, organiser.cookie)).data.activities;
let current = activities.find(item => item.id === first.data.activity.id);
assert.equal(current.notes, 'Carry water');
const moved = await call(`${base}/activities/${current.id}`, 'PATCH', { day: '2026-12-05', title: 'Moved beach morning', version: current.version }, organiser.cookie);
assert.equal(moved.status, 200);
assert.equal(moved.data.activity.day, '2026-12-05');
assert.equal((await call(`${base}/activities/${current.id}`, 'PATCH', { title: 'Stale edit', version: current.version }, member.cookie)).status, 409);
assert.equal((await call(base, 'PATCH', { endDate: '2026-12-04' }, organiser.cookie)).status, 409);
pass('Manual activities save notes, validate dates, reorder, move days and reject stale edits');

const snapshot = { placeId: source.id, title: source.title, category: source.category, region: source.region, latitude: source.latitude, longitude: source.longitude, sourceUrl: source.sourceUrl };
assert.ok([200, 201].includes((await call(`${base}/saved-places`, 'POST', snapshot, member.cookie)).status));
assert.ok([200, 201].includes((await call(`${base}/saved-places`, 'POST', snapshot, member.cookie)).status));
const saved = await call(`${base}/saved-places`, 'GET', undefined, organiser.cookie);
assert.equal(saved.data.places.filter(place => place.placeId === source.id).length, 1);
const fromPlace = await call(`${base}/activities`, 'POST', { title: source.title, day: '2026-12-06', category: source.category, placeId: source.id, location: source.area, latitude: source.latitude, longitude: source.longitude }, member.cookie);
assert.equal(fromPlace.status, 201);
assert.equal(fromPlace.data.activity.placeId, source.id);
pass('A sourced place saves once and is explicitly added to the chosen itinerary day');

const expenseKey = randomUUID();
const expenseBody = { title: 'Group lunch', amountPaise: 125000, category: 'food', date: '2026-12-04', paidByUserId: organiser.user.id };
const paid = await call(`${base}/expenses`, 'POST', expenseBody, organiser.cookie, { 'Idempotency-Key': expenseKey });
assert.equal(paid.status, 201);
assert.equal((await call(`${base}/expenses`, 'POST', expenseBody, organiser.cookie, { 'Idempotency-Key': expenseKey })).data.expense.id, paid.data.expense.id);
const budget = await call(`${base}/budget`, 'GET', undefined, member.cookie);
assert.equal(budget.status, 200);
assert.equal(budget.data.budgetPaise, 2000000);
assert.equal(budget.data.plannedTotalPaise, 800000);
assert.equal(budget.data.actualTotalPaise, 125000);
assert.equal(budget.data.remainingPaise, 1875000);
assert.equal(budget.data.estimatedPerPersonPaise, 200000);
assert.equal((await call(`${base}/expenses`, 'POST', { ...expenseBody, amountPaise: 125000.5 }, organiser.cookie)).status, 400);
assert.equal((await call(`${base}/expenses/${paid.data.expense.id}`, 'PATCH', { title: 'Not mine', version: paid.data.expense.version }, member.cookie)).status, 403);
const editPaid = await call(`${base}/expenses/${paid.data.expense.id}`, 'PATCH', { amountPaise: 130000, version: paid.data.expense.version }, organiser.cookie);
assert.equal(editPaid.status, 200);
assert.equal((await call(`${base}/budget`, 'GET', undefined, organiser.cookie)).data.actualTotalPaise, 130000);
pass('Exact server budget keeps estimates out of actual spending and safely edits paid costs');

for (const resource of ['activities', 'budget', 'saved-places']) {
  assert.equal((await call(`${base}/${resource}`, 'GET', undefined, outsider.cookie)).status, 404);
}
assert.equal((await call(`${base}/activities`, 'POST', { title: 'Intruder', day: '2026-12-04' }, outsider.cookie)).status, 404);
assert.equal((await call(`${base}/members/${member.user.id}`, 'DELETE', undefined, organiser.cookie)).status, 204);
for (const resource of ['activities', 'budget', 'saved-places']) assert.equal((await call(`${base}/${resource}`, 'GET', undefined, member.cookie)).status, 404);
pass('Outsiders and removed members cannot read or change the new trip resource families');

assert.equal((await call(`${base}/activities/${fromPlace.data.activity.id}`, 'DELETE', undefined, organiser.cookie)).status, 204);
assert.equal((await call(`${base}/saved-places/${source.id}`, 'DELETE', undefined, organiser.cookie)).status, 204);
assert.equal((await call(`${base}/expenses/${paid.data.expense.id}`, 'DELETE', undefined, organiser.cookie)).status, 204);
assert.equal((await call(`${base}/budget`, 'GET', undefined, organiser.cookie)).data.actualTotalPaise, 0);
assert.equal((await call(base, 'DELETE', undefined, organiser.cookie)).status, 204);
assert.equal((await call(base, 'DELETE', undefined, organiser.cookie)).status, 204);
for (const suffix of ['', '/activities', '/budget', '/saved-places']) assert.equal((await call(`${base}${suffix}`, 'GET', undefined, organiser.cookie)).status, 404);
assert.ok(!(await call('/api/core/v1/trips', 'GET', undefined, organiser.cookie)).data.trips.some(trip => trip.id === tripId));
assert.equal((await call('/api/core/v1/invitations/accept', 'POST', { token }, outsider.cookie)).status, 404);
pass('Resource deletion and trip soft deletion hide content and invitations without clearing other trips');
console.log(`${groups} planner integration groups passed. Browser animations and deployed Cognito remain outside this HTTP check.`);
