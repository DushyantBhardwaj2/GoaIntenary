import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Deliberately restricted: this writes synthetic trips, never run against cloud accounts.
const base = new URL(process.env.GOA_WEB_URL || 'http://127.0.0.1:3000');
if (!['127.0.0.1', 'localhost'].includes(base.hostname) || base.protocol !== 'http:') {
  throw new Error('Verification requires an HTTP loopback local-test environment.');
}
const origin = base.origin;
let passed = 0;
function pass(name) { passed++; console.log(`PASS ${name}`); }
async function request(route, { method = 'GET', body, cookie, headers = {} } = {}) {
  const response = await fetch(new URL(route, origin), {
    method, redirect: 'manual', signal: AbortSignal.timeout(30000),
    headers: { ...(method !== 'GET' ? { Origin: origin } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const result = response.status === 204 ? null : await response.json();
  return { status: response.status, body: result, response };
}
const mode = await request('/api/auth/status');
assert.equal(mode.status, 200);
assert.equal(mode.body.localAvailable, true, 'Start npm run dev:local before this check.');
pass('Explicit synthetic account mode is available');
const noSession = await request('/api/core/v1/trips');
assert.equal(noSession.status, 401);
pass('Unauthenticated trip reads are rejected');
const csrf = await request('/api/auth/local', { method: 'POST', body: { account: 'aman' }, headers: { Origin: 'https://unrelated.example' } });
assert.equal(csrf.status, 403);
pass('Cross-origin account mutations are rejected');

async function account(name) {
  const login = await request('/api/auth/local', { method: 'POST', body: { account: name } });
  assert.equal(login.status, 200);
  const cookies = login.response.headers.getSetCookie();
  const access = cookies.find(value => value.startsWith('goa_access='));
  assert.ok(access, 'Session cookie missing');
  assert.match(access, /HttpOnly/i);
  assert.match(access, /SameSite=Lax/i);
  const cookie = cookies.map(value => value.split(';')[0]).join('; ');
  const me = await request('/api/core/v1/me', { cookie });
  assert.equal(me.status, 200);
  return { cookie, user: me.body.user };
}
const [aman, riya, outsider] = await Promise.all(['aman', 'riya', 'dev'].map(account));
assert.equal(new Set([aman.user.id, riya.user.id, outsider.user.id]).size, 3);
pass('Three distinct server-authenticated synthetic accounts use HTTP-only cookies');
const key = randomUUID();
const input = { name: 'Verification · Goa weekend', startDate: '2026-11-20', endDate: '2026-11-23', description: 'Synthetic trip used to verify invitations and private access.' };
const created = await request('/api/core/v1/trips', { method: 'POST', body: input, cookie: aman.cookie, headers: { 'Idempotency-Key': key } });
assert.equal(created.status, 201);
const tripId = created.body.trip.id;
const retried = await request('/api/core/v1/trips', { method: 'POST', body: input, cookie: aman.cookie, headers: { 'Idempotency-Key': key } });
assert.ok([200, 201].includes(retried.status));
assert.equal(retried.body.trip.id, tripId);
pass('Trip creation persists and a retried write returns the same trip');
const invalid = await request('/api/core/v1/trips', { method: 'POST', body: { ...input, startDate: '2026-02-30' }, cookie: aman.cookie });
assert.equal(invalid.status, 400);
pass('Impossible calendar dates are rejected');
const invite = await request(`/api/core/v1/trips/${tripId}/invitations`, { method: 'POST', body: {}, cookie: aman.cookie });
assert.equal(invite.status, 201);
assert.equal(invite.body.invitation.requiresApproval, true);
const invitationId = invite.body.invitation.id;
const token = invite.body.invitation.token;
assert.ok(typeof token === 'string' && token.length >= 40);
const join = await request('/api/core/v1/invitations/accept', { method: 'POST', body: { token }, cookie: riya.cookie });
assert.equal(join.status, 200);
assert.equal(join.body.status, 'pending');
const repeat = await request('/api/core/v1/invitations/accept', { method: 'POST', body: { token }, cookie: riya.cookie });
assert.equal(repeat.body.status, 'pending');
assert.equal((await request(`/api/core/v1/trips/${tripId}`, { cookie: riya.cookie })).status, 404);
pass('Approval is required by default; repeated requests do not grant pending users access');
let detail = await request(`/api/core/v1/trips/${tripId}`, { cookie: aman.cookie });
assert.equal(detail.status, 200);
assert.equal(detail.body.members.filter(person => person.userId === riya.user.id).length, 1);
assert.ok(!JSON.stringify(detail.body.invitations).includes(token));
const approve = await request(`/api/core/v1/trips/${tripId}/members/${riya.user.id}/approve`, { method: 'POST', cookie: aman.cookie });
assert.equal(approve.status, 200);
detail = await request(`/api/core/v1/trips/${tripId}`, { cookie: riya.cookie });
assert.equal(detail.status, 200);
assert.equal(detail.body.trip.id, tripId);
assert.deepEqual(detail.body.invitations, []);
pass('Organiser approval grants member access; invitation secrets stay out of lists');
const memberInvite = await request(`/api/core/v1/trips/${tripId}/invitations`, { method: 'POST', body: {}, cookie: riya.cookie });
assert.equal(memberInvite.status, 403);
const copied = await request(`/api/core/v1/trips/${tripId}`, { cookie: outsider.cookie });
const missing = await request(`/api/core/v1/trips/${randomUUID()}`, { cookie: outsider.cookie });
assert.equal(copied.status, 404);
assert.deepEqual(copied.body, missing.body);
pass('Members cannot invite; outsiders receive the same response for private and absent trips');
const revoke = await request(`/api/core/v1/trips/${tripId}/invitations/${invitationId}`, { method: 'DELETE', cookie: aman.cookie });
assert.equal(revoke.status, 204);
assert.equal((await request('/api/core/v1/invitations/accept', { method: 'POST', body: { token }, cookie: outsider.cookie })).status, 404);
pass('Revoked invitations cannot be used to join');
const remove = await request(`/api/core/v1/trips/${tripId}/members/${riya.user.id}`, { method: 'DELETE', cookie: aman.cookie });
assert.equal(remove.status, 204);
assert.equal((await request(`/api/core/v1/trips/${tripId}`, { cookie: riya.cookie })).status, 404);
const remaining = await request('/api/core/v1/trips', { cookie: riya.cookie });
assert.ok(!remaining.body.trips.some(trip => trip.id === tripId));
pass('Removed members immediately lose trip reads and list entries');
const blockedWrite = await request('/api/core/v1/trips', { method: 'POST', body: input, cookie: aman.cookie, headers: { Origin: 'https://unrelated.example' } });
assert.equal(blockedWrite.status, 403);
const logout = await request('/api/auth/logout', { method: 'POST', cookie: aman.cookie });
assert.equal(logout.status, 200);
assert.ok(logout.response.headers.getSetCookie().some(value => /goa_access=.*Max-Age=0/i.test(value)));
pass('The BFF rejects cross-origin writes and sign-out clears the session cookie');
console.log(`${passed} integrated local checks passed. Cloud/Cognito delivery and deployed PostgreSQL are not tested by this script.`);
