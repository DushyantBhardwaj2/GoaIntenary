import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';

// Independent supplemental checks. Creates only synthetic local fixtures.
const base = new URL(process.env.GOA_WEB_URL || 'http://127.0.0.1:3000');
if (!['127.0.0.1', 'localhost'].includes(base.hostname) || base.protocol !== 'http:') {
  throw new Error('Independent checks require the explicit HTTP loopback review server.');
}
let passed = 0;
const pass = name => { passed++; console.log(`PASS ${name}`); };
async function request(path, { method = 'GET', data, raw, cookie, headers = {} } = {}) {
  const response = await fetch(new URL(path, base), {
    method, redirect: 'manual', signal: AbortSignal.timeout(30000),
    headers: { ...(method !== 'GET' ? { Origin: base.origin, 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}), ...headers },
    ...(raw !== undefined || data !== undefined ? { body: raw ?? JSON.stringify(data) } : {}),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
}
async function chunked(path, payload, cookie) {
  return new Promise((resolve, reject) => {
    const req = http.request(new URL(path, base), { method: 'POST', headers: {
      Origin: base.origin, 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked',
      ...(cookie ? { Cookie: cookie } : {}),
    } }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', part => { body += part; });
      response.on('end', () => resolve({ status: response.statusCode, body }));
    });
    req.setTimeout(30000, () => req.destroy(new Error('Chunked check timed out.')));
    req.on('error', reject);
    req.write(payload.slice(0, 100));
    req.end(payload.slice(100));
  });
}
async function rawHostGet(path, cookie) {
  // Undici/fetch can normalize a Host override; use node:http to put the
  // explicit forged Host on the wire for this input-boundary check.
  return new Promise((resolve, reject) => {
    const req = http.request(new URL(path, base), { headers: {
      Cookie: cookie, Host: 'outside.example.invalid', 'X-Forwarded-Host': base.host,
    } }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', part => { body += part; });
      response.on('end', () => resolve({ status: response.statusCode, body }));
    });
    req.setTimeout(30000, () => req.destroy(new Error('Host check timed out.')));
    req.on('error', reject);
    req.end();
  });
}
async function login(account) {
  const result = await request('/api/auth/local', { method: 'POST', data: { account } });
  assert.equal(result.status, 200);
  return result.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
}

const mode = await request('/api/auth/status');
assert.equal(mode.body.localAvailable, true);
const aman = await login('aman');
const riya = await login('riya');
const dev = await login('dev');
for (const account of ['__proto__', 'constructor', 'toString', 'unlisted']) {
  assert.equal((await request('/api/auth/local', { method: 'POST', data: { account } })).status, 400);
}
pass('Synthetic account selection rejects inherited object properties and unknown names');

for (const Origin of ['', 'null', 'http://127.0.0.1:3999', `${base.origin}/`]) {
  assert.equal((await request('/api/auth/local', { method: 'POST', data: { account: 'aman' }, headers: { Origin } })).status, 403);
}
assert.equal((await rawHostGet('/api/core/v1/me', aman)).status, 401);
pass('Missing/null/wrong origins and a non-loopback Host cannot enable synthetic writes or access');

const largeAuth = JSON.stringify({ account: 'aman', padding: 'x'.repeat(10_000) });
assert.equal((await request('/api/auth/local', { method: 'POST', raw: largeAuth })).status, 413);
assert.equal((await chunked('/api/auth/local', largeAuth)).status, 413);
const largeCore = JSON.stringify({ name: 'Size fixture', startDate: '2026-12-01', endDate: '2026-12-02', description: 'x'.repeat(20_000) });
assert.equal((await request('/api/core/v1/trips', { method: 'POST', raw: largeCore, cookie: aman })).status, 413);
assert.equal((await chunked('/api/core/v1/trips', largeCore, aman)).status, 413);
pass('Declared and chunked over-limit bodies are rejected at both BFF endpoints');

assert.equal((await request('/api/auth/local', { method: 'POST', raw: '{invalid' })).status, 400);
assert.equal((await request('/api/core/v1/trips', { method: 'POST', raw: '{invalid', cookie: aman })).status, 400);
const input = { name: 'Independent verification fixture', startDate: '2026-12-01', endDate: '2026-12-03', description: 'Synthetic access-control check.' };
assert.equal((await request('/api/core/v1/trips', { method: 'POST', data: { ...input, role: 'organiser' }, cookie: aman })).status, 400);
assert.equal((await request('/api/core/v1/trips', { method: 'POST', data: { ...input, startDate: '2026-02-29' }, cookie: aman })).status, 400);
pass('Malformed JSON, injected authority fields and invalid calendar dates fail safely');

const retry = randomUUID();
const created = await request('/api/core/v1/trips', { method: 'POST', data: input, cookie: aman, headers: { 'Idempotency-Key': retry } });
assert.equal(created.status, 201);
const tripId = created.body.trip.id;
assert.equal((await request('/api/core/v1/trips', { method: 'POST', data: { ...input, name: 'Changed retry body' }, cookie: aman, headers: { 'Idempotency-Key': retry } })).status, 409);
const invitation = await request(`/api/core/v1/trips/${tripId}/invitations`, { method: 'POST', data: {}, cookie: aman });
assert.equal(invitation.status, 201);
assert.equal(invitation.body.invitation.requiresApproval, true);
const invite = invitation.body.invitation;
const joins = await Promise.all(Array.from({ length: 3 }, () => request('/api/core/v1/invitations/accept', { method: 'POST', data: { token: invite.token }, cookie: riya })));
for (const joined of joins) { assert.equal(joined.status, 200); assert.equal(joined.body.status, 'pending'); }
const pending = await request(`/api/core/v1/trips/${tripId}`, { cookie: aman });
assert.equal(pending.body.members.filter(member => member.userId === '10000000-0000-4000-8000-000000000002').length, 1);
assert.equal((await request(`/api/core/v1/trips/${tripId}/invitations`, { method: 'POST', data: {}, cookie: riya })).status, 404);
assert.equal((await request(`/api/core/v1/trips/${tripId}`, { cookie: riya })).status, 404);
assert.ok(!JSON.stringify(pending.body).includes(invite.token));
assert.match(pending.headers.get('cache-control') || '', /no-store/);
pass('Concurrent acceptance leaves one pending membership; pending reads/writes and secret-list leakage are denied');

const memberId = '10000000-0000-4000-8000-000000000002';
for (let count = 0; count < 2; count++) assert.equal((await request(`/api/core/v1/trips/${tripId}/members/${memberId}/approve`, { method: 'POST', cookie: aman })).status, 200);
const member = await request(`/api/core/v1/trips/${tripId}`, { cookie: riya });
assert.equal(member.status, 200);
assert.deepEqual(member.body.invitations, []);
assert.equal(member.body.members.length, 2);
assert.equal((await request(`/api/core/v1/trips/${tripId}/members/${memberId}`, { method: 'DELETE', cookie: riya })).status, 403);
const outsider = await request(`/api/core/v1/trips/${tripId}`, { cookie: dev });
const absent = await request(`/api/core/v1/trips/${randomUUID()}`, { cookie: dev });
assert.equal(outsider.status, 404);
assert.deepEqual(outsider.body, absent.body);
pass('Approval retries preserve member role; members cannot manage access and outsiders cannot distinguish private trips');

for (let count = 0; count < 2; count++) assert.equal((await request(`/api/core/v1/trips/${tripId}/members/${memberId}`, { method: 'DELETE', cookie: aman })).status, 204);
assert.equal((await request(`/api/core/v1/trips/${tripId}`, { cookie: riya })).status, 404);
assert.equal((await request('/api/core/v1/invitations/accept', { method: 'POST', data: { token: invite.token }, cookie: riya })).status, 404);
for (let count = 0; count < 2; count++) assert.equal((await request(`/api/core/v1/trips/${tripId}/invitations/${invite.id}`, { method: 'DELETE', cookie: aman })).status, 204);
assert.equal((await request('/api/core/v1/invitations/accept', { method: 'POST', data: { token: invite.token }, cookie: dev })).status, 404);
pass('Repeated removal/revocation is safe; removed members and revoked-link users cannot regain access');
console.log(`${passed} independent supplemental groups passed. Browser, restart and cloud checks are reported separately.`);
