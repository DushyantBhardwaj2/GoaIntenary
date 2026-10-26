import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/database.js';
import type { PlaceVoteSummary } from '../src/trip-planning-types.js';

const secret = 'votes-synthetic-test-secret-with-32-bytes';
const ids = ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003'];
function token(index: number): string {
  const encoded = Buffer.from(JSON.stringify({ sub: ids[index], displayName: ['Aman', 'Riya', 'Dev'][index], email: ['aman', 'riya', 'dev'][index] + '@example.invalid', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  return `local.${encoded}.${createHmac('sha256', secret).update(`local.${encoded}`).digest('base64url')}`;
}
const tripInput = { name: 'Manual Goa planner', startDate: '2026-12-04', endDate: '2026-12-06', region: 'north', travellerCount: 4, budgetPaise: 2_000_000, styles: ['beaches', 'food'] };
const snapshot = { placeId: 'fort-aguada', title: 'Fort Aguada', category: 'culture', region: 'north', latitude: 15.492, longitude: 73.774, sourceUrl: 'https://goa-tourism.com/' };

test('saved places keep one interested vote per accepted member', async (t) => {
  const testRoot = fileURLToPath(new URL('../../../.data/tests/', import.meta.url));
  await mkdir(testRoot, { recursive: true });
  const directory = await mkdtemp(join(testRoot, 'goa-votes-test-'));
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
    const votesUrl = (placeId = snapshot.placeId) => `/v1/trips/${tripId}/saved-places/${placeId}/votes`;
    const voteRows = (placeId = snapshot.placeId) => database.query<{ user_id: string }>(
      'SELECT user_id::text FROM goa_core_place_votes WHERE trip_id=$1 AND place_id=$2 ORDER BY user_id', [tripId, placeId]);
    const voteAudits = () => database.query<{ action: string; actor_id: string; target_id: string; target_key: string | null }>(
      `SELECT action, actor_id::text, target_id::text, target_key FROM goa_core_audit
       WHERE trip_id=$1 AND action IN ('vote.cast','vote.withdrawn') ORDER BY created_at, action`, [tripId]);

    await t.test('Aman saves a place, and a pending member cannot vote on it', async () => {
      const created = await request(0, 'POST', '/v1/trips', tripInput);
      assert.equal(created.statusCode, 201, created.body);
      tripId = created.json().trip.id as string;
      const invitation = await request(0, 'POST', `/v1/trips/${tripId}/invitations`, { requiresApproval: true });
      assert.equal(invitation.statusCode, 201, invitation.body);
      const joined = await request(1, 'POST', '/v1/invitations/accept', { token: invitation.json().invitation.token });
      assert.equal(joined.statusCode, 200, joined.body);
      assert.equal(joined.json().status, 'pending');

      const saved = await request(0, 'POST', `/v1/trips/${tripId}/saved-places`, snapshot);
      assert.equal(saved.statusCode, 200, saved.body);
      assert.equal(saved.json().place.placeId, snapshot.placeId);
      assert.equal(saved.json().place.title, snapshot.title);
      assert.equal((await request(0, 'GET', `/v1/trips/${tripId}/saved-places`)).json().places.length, 1);

      const pending = await request(1, 'PUT', votesUrl(), { interested: true });
      assert.equal(pending.statusCode, 404, pending.body);
      assert.equal(pending.json().error.message, 'That resource is unavailable.');
      assert.equal((await request(1, 'GET', votesUrl())).statusCode, 404);
      assert.equal((await voteRows()).length, 0);

      const approved = await request(0, 'POST', `/v1/trips/${tripId}/members/${ids[1]}/approve`, {});
      assert.equal(approved.statusCode, 200, approved.body);
      const empty = await request(1, 'GET', votesUrl());
      assert.equal(empty.statusCode, 200, empty.body);
      assert.deepEqual(empty.json(), { count: 0, voters: [] });
    });

    await t.test('Aman and Riya each mark interested once and the summary names both', async () => {
      const riya = await request(1, 'PUT', votesUrl(), { interested: true });
      assert.equal(riya.statusCode, 200, riya.body);
      const aman = await request(0, 'PUT', votesUrl(), { interested: true });
      assert.equal(aman.statusCode, 200, aman.body);
      const summary = aman.json() as PlaceVoteSummary;
      assert.equal(summary.count, 2);
      assert.deepEqual(summary.voters, [
        { userId: ids[0], displayName: 'Aman' },
        { userId: ids[1], displayName: 'Riya' },
      ]);
      const listed = await request(0, 'GET', votesUrl());
      assert.equal(listed.statusCode, 200, listed.body);
      assert.deepEqual(listed.json(), summary);
      const rows = await voteRows();
      assert.deepEqual(rows.map((row) => row.user_id), [ids[0], ids[1]]);
      const audits = await voteAudits();
      assert.deepEqual(audits.map((row) => row.action), ['vote.cast', 'vote.cast']);
      assert.deepEqual(audits.map((row) => row.actor_id), [ids[1], ids[0]]);
      assert.ok(audits.every((row) => row.target_id === tripId && row.target_key === snapshot.placeId));
      assert.equal(audits.some((row) => row.target_key === 'Aman' || row.target_key === 'Riya'), false);
    });

    await t.test('Aman voting interested again stays one row', async () => {
      const again = await request(0, 'PUT', votesUrl(), { interested: true });
      assert.equal(again.statusCode, 200, again.body);
      const summary = again.json() as PlaceVoteSummary;
      assert.equal(summary.count, 2);
      assert.equal(summary.voters.filter((voter) => voter.userId === ids[0]).length, 1);
      assert.equal((await voteRows()).filter((row) => row.user_id === ids[0]).length, 1);
      assert.equal((await voteAudits()).filter((row) => row.action === 'vote.cast' && row.actor_id === ids[0]).length, 1);
      const rated = await request(0, 'PUT', votesUrl(), { interested: true, rating: 5 });
      assert.equal(rated.statusCode, 400, rated.body);
      assert.equal((await voteRows()).length, 2);
    });

    await t.test('Aman withdrawing interest leaves Riya', async () => {
      const withdrawn = await request(0, 'PUT', votesUrl(), { interested: false });
      assert.equal(withdrawn.statusCode, 200, withdrawn.body);
      assert.deepEqual(withdrawn.json(), { count: 1, voters: [{ userId: ids[1], displayName: 'Riya' }] });
      const repeated = await request(0, 'PUT', votesUrl(), { interested: false });
      assert.deepEqual(repeated.json(), { count: 1, voters: [{ userId: ids[1], displayName: 'Riya' }] });
      assert.deepEqual((await voteRows()).map((row) => row.user_id), [ids[1]]);
      const audits = await voteAudits();
      assert.equal(audits.filter((row) => row.action === 'vote.withdrawn').length, 1);
      assert.equal(audits.find((row) => row.action === 'vote.withdrawn')!.actor_id, ids[0]);
      assert.equal(audits.find((row) => row.action === 'vote.withdrawn')!.target_key, snapshot.placeId);
    });

    await t.test('a place that was not saved cannot collect a vote', async () => {
      const missing = 'not-saved';
      const put = await request(0, 'PUT', votesUrl(missing), { interested: true });
      assert.equal(put.statusCode, 404, put.body);
      assert.equal(put.json().error.message, 'That resource is unavailable.');
      assert.equal((await request(1, 'GET', votesUrl(missing))).statusCode, 404);
      assert.equal((await voteRows(missing)).length, 0);
      assert.equal((await request(0, 'GET', `/v1/trips/${tripId}/saved-places`)).json().places.length, 1);
    });

    await t.test('Dev, who never joins, and a removed member are unavailable', async () => {
      const outsider = await request(2, 'PUT', votesUrl(), { interested: true });
      assert.equal(outsider.statusCode, 404, outsider.body);
      assert.equal(outsider.json().error.message, 'That resource is unavailable.');
      assert.equal((await request(2, 'GET', votesUrl())).statusCode, 404);
      assert.deepEqual((await voteRows()).map((row) => row.user_id), [ids[1]]);

      assert.equal((await request(0, 'DELETE', `/v1/trips/${tripId}/members/${ids[1]}`)).statusCode, 204);
      const removed = await request(1, 'PUT', votesUrl(), { interested: false });
      assert.equal(removed.statusCode, 404, removed.body);
      assert.equal(removed.json().error.message, 'That resource is unavailable.');
      assert.equal((await request(1, 'GET', votesUrl())).statusCode, 404);
      const stillThere = await request(0, 'GET', votesUrl());
      assert.equal(stillThere.statusCode, 200, stillThere.body);
      assert.deepEqual(stillThere.json(), { count: 1, voters: [{ userId: ids[1], displayName: 'Riya' }] });
    });

    await t.test('unsaving the place removes its votes and the save can be removed again', async () => {
      assert.equal((await voteRows()).length, 1);
      const removed = await request(0, 'DELETE', `/v1/trips/${tripId}/saved-places/${snapshot.placeId}`);
      assert.equal(removed.statusCode, 204, removed.body);
      assert.equal((await voteRows()).length, 0);
      assert.equal((await database.query('SELECT user_id FROM goa_core_place_votes WHERE trip_id=$1', [tripId])).length, 0);
      assert.equal((await request(0, 'GET', `/v1/trips/${tripId}/saved-places`)).json().places.length, 0);
      assert.equal((await request(0, 'GET', votesUrl())).statusCode, 404);
      assert.equal((await request(0, 'DELETE', `/v1/trips/${tripId}/saved-places/${snapshot.placeId}`)).statusCode, 204);
      const unsaved = await database.query<{ target_key: string | null }>(
        `SELECT target_key FROM goa_core_audit WHERE trip_id=$1 AND action='place.unsaved'`, [tripId]);
      assert.equal(unsaved.length, 1);
      assert.equal(unsaved[0]!.target_key, snapshot.placeId);
    });
  } finally {
    if (app) await app.close();
    await database.close();
    assert.ok(resolve(directory).startsWith(resolve(testRoot) + sep));
    await rm(directory, { recursive: true, force: true });
  }
});
