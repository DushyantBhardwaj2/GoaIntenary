import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// This suite is deliberately restricted to synthetic local accounts and data.
const target = new URL(process.env.GOA_WEB_URL || 'http://127.0.0.1:3000');
if (target.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(target.hostname)) {
  throw new Error('Only the synthetic HTTP loopback environment is permitted.');
}
let groups = 0;
const pass = name => { groups++; console.log(`PASS ${name}`); };
async function call(path, method = 'GET', body, cookie) {
  const response = await fetch(new URL(path, target), {
    method, redirect: 'manual', signal: AbortSignal.timeout(30000),
    headers: {
      ...(method === 'GET' ? {} : { Origin: target.origin }),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await response.text();
  return { status: response.status, data: raw ? JSON.parse(raw) : null, headers: response.headers };
}
assert.equal((await call('/api/auth/status')).data.localAvailable, true, 'Start npm run dev:local first.');
async function login(account) {
  const result = await call('/api/auth/local', 'POST', { account });
  assert.equal(result.status, 200);
  const cookie = result.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const me = await call('/api/core/v1/me', 'GET', undefined, cookie);
  assert.equal(me.status, 200);
  return { cookie, user: me.data.user };
}
const [owner, member, outsider] = await Promise.all(['aman', 'riya', 'dev'].map(login));
const created = await call('/api/core/v1/trips', 'POST', {
  name: `Synthetic loading check ${randomUUID().slice(0, 8)}`,
  startDate: '2026-12-04', endDate: '2026-12-06', travellerCount: 3,
}, owner.cookie);
assert.equal(created.status, 201);
const base = `/api/core/v1/trips/${created.data.trip.id}`;
try {
  const invite = await call(`${base}/invitations`, 'POST', { requiresApproval: false }, owner.cookie);
  assert.equal(invite.status, 201);
  assert.equal((await call('/api/core/v1/invitations/accept', 'POST', { token: invite.data.invitation.token }, member.cookie)).status, 200);
  const activities = [];
  for (let index = 0; index < 5; index++) {
    const result = await call(`${base}/activities`, 'POST', { title: `Loading check activity ${index + 1}`, day: '2026-12-04' }, owner.cookie);
    assert.equal(result.status, 201);
    activities.push(result.data.activity);
  }
  assert.equal((await call(`${base}/activities`, 'GET', undefined, member.cookie)).data.activities.length, 5);
  pass('A signed-in member loads the five-activity trip through the existing API contract');

  const first = `${base}/activities/${activities[0].id}`;
  const second = `${base}/activities/${activities[1].id}`;
  const reads = [`${first}/status`, `${first}/attendees`, `${first}/comments`, `${second}/status`, `${second}/attendees`, `${second}/comments`, `${base}/bookings`, `${base}/expense-participants`];
  const responses = await Promise.all(reads.map(path => call(path, 'GET', undefined, member.cookie)));
  for (const response of responses) {
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control') || '', /no-store/);
  }
  assert.equal(responses[0].data.status, 'planned');
  assert.deepEqual(responses[1].data.participantIds, []);
  assert.deepEqual(responses[2].data.comments, []);
  pass('Parallel optional-detail reads succeed and private HTTP responses remain non-cacheable');

  const status = await call(`${first}/status`, 'PUT', { status: 'confirmed' }, member.cookie);
  assert.equal(status.status, 200);
  assert.equal(status.data.status, 'confirmed');
  const attendees = await call(`${first}/attendees`, 'PUT', { participantIds: [owner.user.id, member.user.id] }, member.cookie);
  assert.equal(attendees.status, 200);
  assert.deepEqual([...attendees.data.participantIds].sort(), [owner.user.id, member.user.id].sort());
  assert.equal((await call(`${first}/status`, 'GET', undefined, owner.cookie)).data.status, 'confirmed');
  assert.deepEqual((await call(`${first}/attendees`, 'GET', undefined, owner.cookie)).data.participantIds.sort(), [owner.user.id, member.user.id].sort());
  pass('Status and selected attendees persist after reopening details');

  const booking = await call(`${base}/bookings`, 'POST', { targetType: 'activity', targetId: activities[0].id, providerName: 'Synthetic provider', reference: 'SYNTHETIC-ONLY' }, owner.cookie);
  assert.equal(booking.status, 201);
  assert.equal((await call(`${base}/bookings`, 'GET', undefined, member.cookie)).data.bookings[0].id, booking.data.booking.id);
  const comment = await call(`${first}/comments`, 'POST', { body: 'Synthetic optional-detail comment' }, member.cookie);
  assert.equal(comment.status, 201);
  assert.equal((await call(`${first}/comments`, 'GET', undefined, owner.cookie)).data.comments[0].id, comment.data.comment.id);
  const edited = await call(`${first}/comments/${comment.data.comment.id}`, 'PATCH', { body: 'Synthetic edited comment' }, member.cookie);
  assert.equal(edited.status, 200);
  assert.equal((await call(`${first}/comments`, 'GET', undefined, member.cookie)).data.comments[0].body, 'Synthetic edited comment');
  pass('Booking choices and comment writes remain visible on subsequent server reads');

  assert.equal((await call(`${first}/attendees`, 'PUT', { participantIds: [outsider.user.id] }, owner.cookie)).status, 400);
  assert.deepEqual((await call(`${first}/attendees`, 'GET', undefined, owner.cookie)).data.participantIds.sort(), [owner.user.id, member.user.id].sort());
  for (const path of [`${first}/status`, `${first}/attendees`, `${first}/comments`, `${base}/bookings`, `${base}/expense-participants`]) {
    assert.equal((await call(path, 'GET', undefined, outsider.cookie)).status, 404);
  }
  pass('Failed edits preserve prior values and outsiders cannot read optional trip data');

  assert.equal((await call(`${base}/members/${member.user.id}`, 'DELETE', undefined, owner.cookie)).status, 204);
  for (const path of [`${first}/status`, `${first}/attendees`, `${first}/comments`, `${base}/bookings`, `${base}/expense-participants`]) {
    assert.equal((await call(path, 'GET', undefined, member.cookie)).status, 404);
  }
  assert.equal((await call(`${first}/comments`, 'POST', { body: 'Removed member attempt' }, member.cookie)).status, 404);
  assert.equal((await call(`${first}/status`)).status, 401);
  assert.equal((await call(`${first}/status`, 'GET', undefined, owner.cookie)).status, 200);
  pass('Removed and signed-out readers reach fresh authorization checks; the organiser retains access');
  console.log(`${groups} performance-path HTTP regression groups passed. UI request counts, rendering and IAM connection lifecycle require the separate client/adapter checks.`);
} finally {
  assert.equal((await call(base, 'DELETE', undefined, owner.cookie)).status, 204);
}
