import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const web = new URL(process.env.GOA_WEB_URL || 'http://127.0.0.1:3000');
if (web.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(web.hostname)) throw new Error('Only the synthetic HTTP loopback environment is permitted.');
let groups = 0;
const failures = [];
const pass = name => { groups++; console.log(`PASS ${name}`); };
const expect = (actual, expected, name) => {
  if (actual !== expected) { failures.push(name); console.log(`FAIL ${name}: expected ${expected}, received ${actual}`); return false; }
  return true;
};
async function call(path, method = 'GET', body, cookie, extra = {}) {
  const response = await fetch(new URL(path, web), {
    method, redirect: 'manual', signal: AbortSignal.timeout(30000),
    headers: { ...(method !== 'GET' ? { Origin: web.origin } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...extra },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const raw = await response.text();
  return { status: response.status, data: raw ? JSON.parse(raw) : null, headers: response.headers };
}
async function login(account) {
  const response = await call('/api/auth/local', 'POST', { account });
  assert.equal(response.status, 200);
  const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const profile = await call('/api/core/v1/me', 'GET', undefined, cookie);
  assert.equal(profile.status, 200);
  return { cookie, id: profile.data.user.id };
}
assert.equal((await call('/api/auth/status')).data.localAvailable, true);
const [aman, riya, dev] = await Promise.all(['aman', 'riya', 'dev'].map(login));
const catalogue = await call('/api/discovery/places');
assert.equal(catalogue.status, 200);
assert.ok(catalogue.data.total >= 12);
assert.equal(catalogue.data.catalogue.kind, 'curated');
for (const query of ['?q=a&q=b', '?url=http://example.invalid', '?q=%00', '?category=unlisted']) assert.equal((await call(`/api/discovery/places${query}`)).status, 400);
assert.equal((await call('/api/discovery/places/no-such-place')).status, 404);
assert.equal((await call('/api/discovery/places', 'POST', {})).status, 405);
pass('Actual public discovery rejects unknown/duplicate filters, control characters and writes');

const body = { name: 'Independent planner fixture', startDate: '2026-12-01', endDate: '2026-12-03', budgetPaise: 2_000_000, travellerCount: 3 };
const trip = await call('/api/core/v1/trips', 'POST', body, aman.cookie, { 'Idempotency-Key': randomUUID() });
const other = await call('/api/core/v1/trips', 'POST', { ...body, name: 'Independent foreign-ID fixture' }, aman.cookie);
assert.equal(trip.status, 201); assert.equal(other.status, 201);
const base = `/api/core/v1/trips/${trip.data.trip.id}`;
const foreign = `/api/core/v1/trips/${other.data.trip.id}`;
for (const route of ['/', '/trips', '/explore', '/auth', '/join', `/trips/${trip.data.trip.id}`]) {
  const response = await fetch(new URL(route, web), { redirect: 'manual', signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(response.headers.get('content-type') || '', /text\/html/);
  assert.ok(!html.includes(body.name), 'Unauthenticated HTML must not contain the private fixture title.');
}
pass('All new HTML route shells respond; unauthenticated HTML does not contain the private trip title');
const invite = await call(`${base}/invitations`, 'POST', {}, aman.cookie);
assert.equal(invite.status, 201);
const token = invite.data.invitation.token;
assert.equal((await call('/api/core/v1/invitations/accept', 'POST', { token }, riya.cookie)).data.status, 'pending');
for (const family of ['activities', 'saved-places', 'budget']) assert.equal((await call(`${base}/${family}`, 'GET', undefined, riya.cookie)).status, 404);
assert.equal((await call(`${base}/members/${riya.id}/approve`, 'POST', undefined, aman.cookie)).status, 200);
assert.equal((await call(base, 'PATCH', { travellerCount: 50 }, riya.cookie)).status, 403);
pass('Pending users cannot access any new family; ordinary members cannot edit trip settings');

const first = (await call(`${base}/activities`, 'POST', { title: 'Exact estimate', day: '2026-12-01', estimatedCostPaise: 800_000, category: 'beach', startTime: '09:00', endTime: '10:00', notes: 'Preserved note' }, riya.cookie)).data.activity;
const second = (await call(`${base}/activities`, 'POST', { title: 'One paise estimate', day: '2026-12-01', estimatedCostPaise: 1, category: 'food' }, aman.cookie)).data.activity;
const last = (await call(`${base}/activities`, 'POST', { title: 'Last day', day: '2026-12-03' }, aman.cookie)).data.activity;
const foreignActivity = (await call(`${foreign}/activities`, 'POST', { title: 'Foreign child' }, aman.cookie)).data.activity;
const concurrent = await Promise.all(['Version A', 'Version B'].map(notes => call(`${base}/activities/${first.id}`, 'PATCH', { version: first.version, notes }, riya.cookie)));
assert.deepEqual(concurrent.map(response => response.status).sort(), [200, 409]);
const current = concurrent.find(response => response.status === 200).data.activity;
const beforeOrder = await call(`${base}/activities`, 'GET', undefined, aman.cookie);
assert.equal((await call(`${base}/activities/reorder`, 'POST', { day: '2026-12-01', activityIds: [first.id, foreignActivity.id] }, aman.cookie)).status, 409);
assert.deepEqual((await call(`${base}/activities`, 'GET', undefined, aman.cookie)).data, beforeOrder.data);
const ordered = await call(`${base}/activities/reorder`, 'POST', { day: '2026-12-01', activityIds: [second.id, first.id] }, riya.cookie);
assert.equal(ordered.status, 200);
assert.deepEqual(ordered.data.activities.map(activity => activity.id), [second.id, first.id]);
assert.equal(ordered.data.activities.find(activity => activity.id === first.id).startTime, '09:00');
assert.equal((await call(`${base}/activities/${first.id}`, 'PATCH', { version: current.version, notes: 'Stale after reorder' }, aman.cookie)).status, 409);
assert.equal((await call(base, 'PATCH', { endDate: '2026-12-02' }, aman.cookie)).status, 409);
assert.equal((await call(`${base}/activities/${foreignActivity.id}`, 'DELETE', undefined, aman.cookie)).status, 404);
assert.ok((await call(`${foreign}/activities`, 'GET', undefined, aman.cookie)).data.activities.some(activity => activity.id === foreignActivity.id));
pass('Concurrent stale edits and foreign-ID reorder are atomic; manual order preserves time labels and trip dates');

const place = catalogue.data.places[0];
const snapshot = { placeId: place.id, title: place.title, category: place.category, region: place.region, latitude: place.latitude, longitude: place.longitude, sourceUrl: place.sourceUrl };
const count = (await call(`${base}/activities`, 'GET', undefined, aman.cookie)).data.activities.length;
const saves = await Promise.all([aman, riya].map(account => call(`${base}/saved-places`, 'POST', snapshot, account.cookie)));
assert.ok(saves.every(response => response.status === 200));
assert.equal((await call(`${base}/saved-places`, 'GET', undefined, aman.cookie)).data.places.length, 1);
assert.equal((await call(`${base}/activities`, 'GET', undefined, aman.cookie)).data.activities.length, count);
let sourceChecksPassed = true;
for (const sourceUrl of ['javascript:alert(1)', 'file:///private', 'https://user:secret@example.invalid']) {
  const result = await call(`${base}/saved-places`, 'POST', { ...snapshot, placeId: 'invalid-source', sourceUrl }, aman.cookie);
  if (!expect(result.status, 400, 'Saved-place source URL scheme/credential validation')) sourceChecksPassed = false;
}
if (sourceChecksPassed) pass('Concurrent saved places remain unique and unscheduled; executable/file/credential source URLs fail validation');

const paidBody = { title: 'Member paid lunch', amountPaise: 125_000, category: 'food', date: '2026-12-01', paidByUserId: riya.id };
const key = randomUUID();
const expenses = await Promise.all([1, 2].map(() => call(`${base}/expenses`, 'POST', paidBody, riya.cookie, { 'Idempotency-Key': key })));
assert.ok(expenses.every(response => response.status === 201));
assert.equal(expenses[0].data.expense.id, expenses[1].data.expense.id);
const paid = expenses[0].data.expense;
const one = (await call(`${base}/expenses`, 'POST', { title: 'One paise', amountPaise: 1, category: 'other', date: '2026-12-01' }, aman.cookie)).data.expense;
for (const amountPaise of [0, -1, 1.5, '1250.00', 1_000_000_001]) assert.equal((await call(`${base}/expenses`, 'POST', { ...paidBody, amountPaise }, riya.cookie)).status, 400);
assert.equal((await call(`${base}/expenses`, 'POST', { ...paidBody, beneficiaries: [aman.id] }, riya.cookie)).status, 400);
assert.equal((await call(`${base}/expenses/${one.id}`, 'PATCH', { version: one.version, title: 'Member cannot edit organiser expense' }, riya.cookie)).status, 403);
const budget = (await call(`${base}/budget`, 'GET', undefined, riya.cookie)).data;
assert.deepEqual([budget.budgetPaise, budget.plannedTotalPaise, budget.actualTotalPaise, budget.remainingPaise, budget.estimatedPerPersonPaise, budget.actualPerPersonPaise], [2_000_000, 800_001, 125_001, 1_874_999, 266_667, 41_667]);
assert.equal(budget.categoryTotals.reduce((sum, row) => sum + row.plannedPaise, 0), budget.plannedTotalPaise);
assert.equal(budget.categoryTotals.reduce((sum, row) => sum + row.actualPaise, 0), budget.actualTotalPaise);
assert.equal((await call(base, 'PATCH', { travellerCount: 7 }, aman.cookie)).status, 200);
const rounded = (await call(`${base}/budget`, 'GET', undefined, aman.cookie)).data;
assert.equal(rounded.estimatedPerPersonPaise, 114_286);
assert.equal(rounded.actualPerPersonPaise, 17_857);
assert.equal(rounded.actualTotalPaise, 125_001);
assert.equal((await call(base, 'PATCH', { travellerCount: 3 }, aman.cookie)).status, 200);
pass('One-paise totals and declared-headcount rounding are exact; spending retries do not duplicate and estimates stay separate');

for (const family of ['activities', 'saved-places', 'budget']) {
  const actual = await call(`${base}/${family}`, 'GET', undefined, dev.cookie);
  const absent = await call(`/api/core/v1/trips/${randomUUID()}/${family}`, 'GET', undefined, dev.cookie);
  assert.equal(actual.status, 404); assert.deepEqual(actual.data, absent.data);
}
assert.equal((await call(`${base}/members/${riya.id}`, 'DELETE', undefined, aman.cookie)).status, 204);
for (const family of ['activities', 'saved-places', 'budget']) assert.equal((await call(`${base}/${family}`, 'GET', undefined, riya.cookie)).status, 404);
assert.equal((await call(`${base}/activities/${last.id}`, 'DELETE', undefined, riya.cookie)).status, 404);
assert.equal((await call(`${base}/expenses/${paid.id}`, 'PATCH', { version: paid.version, title: 'Removed edit' }, riya.cookie)).status, 404);
const correction = await call(`${base}/expenses/${paid.id}`, 'PATCH', { version: paid.version, title: 'Corrected historical lunch', amountPaise: paid.amountPaise, category: paid.category, date: paid.date, paidByUserId: riya.id }, aman.cookie);
const historicalPassed = expect(correction.status, 200, 'Organiser full-form correction preserves unchanged historical removed payer');
if (historicalPassed) assert.equal(correction.data.expense.paidByDisplayName, 'Riya');
assert.equal((await call(`${base}/expenses`, 'POST', { ...paidBody, title: 'New removed payer' }, aman.cookie)).status, 400);
assert.equal((await call(`${base}/expenses/${one.id}`, 'PATCH', { version: one.version, paidByUserId: riya.id }, aman.cookie)).status, 400);
if (historicalPassed) pass('Removed users lose all new families; historical corrections preserve payer while new assignments stay denied');

assert.equal((await call(base, 'DELETE', undefined, aman.cookie)).status, 204);
assert.equal((await call(base, 'DELETE', undefined, aman.cookie)).status, 204);
for (const suffix of ['', '/activities', '/saved-places', '/budget']) assert.equal((await call(`${base}${suffix}`, 'GET', undefined, aman.cookie)).status, 404);
assert.equal((await call('/api/core/v1/invitations/accept', 'POST', { token }, dev.cookie)).status, 404);
assert.equal((await call(foreign, 'GET', undefined, aman.cookie)).status, 200);
assert.equal((await call(foreign, 'DELETE', undefined, aman.cookie)).status, 204);
pass('Repeat-safe soft deletion hides every child and invitation while preserving the other trip');
console.log(`${groups} independent planner groups passed; ${failures.length} failure(s). Rendered UI/GPU/cloud remain outside this HTTP check.`);
if (failures.length) process.exitCode = 1;
