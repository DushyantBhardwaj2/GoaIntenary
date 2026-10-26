import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const target = new URL(process.env.GOA_WEB_URL || 'http://127.0.0.1:3000');
if (target.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(target.hostname)) {
  throw new Error('Reel verification only writes to local synthetic environments.');
}
const origin = target.origin;
let groups = 0;
const pass = (name) => { groups++; console.log(`PASS ${name}`); };
async function call(route, method = 'GET', body, cookie, headers = {}) {
  const response = await fetch(new URL(route, origin), {
    method, redirect: 'manual', signal: AbortSignal.timeout(60_000),
    headers: { ...(method !== 'GET' ? { Origin: origin } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, data: response.status === 204 ? null : await response.json(), response };
}
assert.equal((await call('/api/auth/status')).data.localAvailable, true, 'Start a local synthetic test server first.');
async function login(account) {
  const result = await call('/api/auth/local', 'POST', { account });
  assert.equal(result.status, 200);
  const cookie = result.response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
  const profile = await call('/api/core/v1/me', 'GET', undefined, cookie);
  assert.equal(profile.status, 200);
  return { cookie, user: profile.data.user };
}
const [owner, member, outsider] = await Promise.all(['aman', 'riya', 'dev'].map(login));
const created = await call('/api/core/v1/trips', 'POST', {
  name: 'Reel verification · synthetic Goa', startDate: '2026-12-04', endDate: '2026-12-06',
  region: 'south', travellerCount: 3, budgetPaise: null, styles: ['beaches'],
}, owner.cookie);
assert.equal(created.status, 201, JSON.stringify(created.data));
const base = `/api/core/v1/trips/${created.data.trip.id}`;
const ideas = `${base}/reel-ideas`;
assert.equal((await call(ideas)).status, 401);
assert.equal((await call(ideas, 'GET', undefined, outsider.cookie)).status, 404);
const invitation = await call(`${base}/invitations`, 'POST', { requiresApproval: true }, owner.cookie);
assert.equal(invitation.status, 201);
assert.equal((await call('/api/core/v1/invitations/accept', 'POST', { token: invitation.data.invitation.token }, member.cookie)).data.status, 'pending');
assert.equal((await call(ideas, 'GET', undefined, member.cookie)).status, 404);
assert.equal((await call(`${base}/members/${member.user.id}/approve`, 'POST', {}, owner.cookie)).status, 200);
pass('Cookie sessions, proxy routing and private/pending membership checks');

const input = { title: 'Sunset transition', kind: 'reel', instagramUrl: 'https://www.instagram.com/reel/synthetic-reference/',
  location: 'Palolem beach', notes: 'Film just before sunset.', participantUserIds: [member.user.id, owner.user.id] };
const key = randomUUID();
const saved = await call(ideas, 'POST', input, member.cookie, { 'Idempotency-Key': key });
assert.equal(saved.status, 201, JSON.stringify(saved.data));
const ideaId = saved.data.idea.id;
assert.equal((await call(ideas, 'POST', input, member.cookie, { 'Idempotency-Key': key })).data.idea.id, ideaId);
const view = await call(ideas, 'GET', undefined, owner.cookie);
assert.equal(view.status, 200);
assert.equal(view.data.ideas.length, 1);
assert.equal(view.data.ideas[0].notes, input.notes);
assert.deepEqual(view.data.ideas[0].participantUserIds, [...input.participantUserIds].sort());
assert.match(view.response.headers.get('cache-control'), /no-store/);
pass('Instagram reference, selected people and notes save across accounts without duplicate retries');

const photo = await call(ideas, 'POST', { ...input, title: 'Beach group photo', kind: 'photo', instagramUrl: null }, owner.cookie);
assert.equal(photo.status, 201);
for (const invalidUrl of ['javascript:alert(1)', 'https://instagram.com.evil.example/reel/x', 'http://instagram.com/p/x']) {
  assert.equal((await call(ideas, 'POST', { ...input, instagramUrl: invalidUrl }, member.cookie)).status, 400);
}
assert.equal((await call(ideas, 'POST', { ...input, participantUserIds: [outsider.user.id] }, member.cookie)).status, 400);
assert.equal((await call(ideas, 'POST', { ...input, participantUserIds: [] }, member.cookie)).status, 400);
assert.equal((await call(ideas, 'POST', input, member.cookie, { Origin: 'https://outside.example' })).status, 403);
assert.equal((await call(`${ideas}/${photo.data.idea.id}`, 'PATCH', { ...input, version: 1 }, member.cookie)).status, 403);
pass('Photo ideas without a URL, safe references, selected-member validation and same-origin protection');

const changed = await call(`${ideas}/${ideaId}`, 'PATCH', { ...input, notes: 'Bring a tripod.', version: 1 }, member.cookie);
assert.equal(changed.status, 200);
assert.equal(changed.data.idea.version, 2);
assert.equal((await call(`${ideas}/${ideaId}`, 'PATCH', { ...input, version: 1 }, owner.cookie)).status, 409);
assert.equal((await call(ideas, 'GET', undefined, owner.cookie)).data.ideas.find((item) => item.id === ideaId).notes, 'Bring a tripod.');
assert.equal((await call(`${ideas}/${photo.data.idea.id}`, 'DELETE', undefined, member.cookie)).status, 403);
assert.equal((await call(`${ideas}/${ideaId}`, 'DELETE', undefined, member.cookie)).status, 204);
assert.equal((await call(`${ideas}/${ideaId}`, 'DELETE', undefined, member.cookie)).status, 204);
assert.equal((await call(ideas, 'GET', undefined, owner.cookie)).data.ideas.length, 1);
pass('Versioned editing and authorised repeatable deletion survive the website proxy');

assert.equal((await call(`${base}/members/${member.user.id}`, 'DELETE', undefined, owner.cookie)).status, 204);
assert.equal((await call(ideas, 'GET', undefined, member.cookie)).status, 404);
assert.equal((await call(ideas, 'POST', input, member.cookie)).status, 404);
assert.equal((await call(ideas, 'GET', undefined, owner.cookie)).data.ideas.length, 1);
pass('Removed member loses access while saved trip ideas remain available');
console.log(`${groups} reel idea HTTP groups passed.`);
