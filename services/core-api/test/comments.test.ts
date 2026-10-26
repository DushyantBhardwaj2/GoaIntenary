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
import type { ActivityComment } from '../src/trip-planning-types.js';

const secret = 'comments-synthetic-test-secret-with-32-bytes';
const ids = ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003'];
function token(index: number): string {
  const encoded = Buffer.from(JSON.stringify({ sub: ids[index], displayName: ['Aman', 'Riya', 'Dev'][index], email: ['aman', 'riya', 'dev'][index] + '@example.invalid', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  return `local.${encoded}.${createHmac('sha256', secret).update(`local.${encoded}`).digest('base64url')}`;
}
const tripInput = { name: 'Comment thread', startDate: '2026-12-04', endDate: '2026-12-06', region: 'north', travellerCount: 4, budgetPaise: 2_000_000, styles: ['beaches'] };
const isoTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

test('activity comments stay on the trip and follow author and organiser rules', async (t) => {
  const testRoot = fileURLToPath(new URL('../../../.data/tests/', import.meta.url));
  await mkdir(testRoot, { recursive: true });
  const directory = await mkdtemp(join(testRoot, 'goa-comments-test-'));
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
    let activityId = '';
    let riyaCommentId = '';
    let amanCommentId = '';
    const url = (activity = activityId) => `/v1/trips/${tripId}/activities/${activity}/comments`;
    const commentCount = async () => (await database.query<{ id: string }>('SELECT id FROM goa_core_activity_comments')).length;
    const listed = async (index: number, activity = activityId) => (await request(index, 'GET', url(activity))).json().comments as ActivityComment[];

    await t.test('an accepted member creates a comment, edits it, and cannot edit someone else', async () => {
      const created = await request(0, 'POST', '/v1/trips', tripInput);
      assert.equal(created.statusCode, 201, created.body);
      tripId = created.json().trip.id as string;
      const invitation = await request(0, 'POST', `/v1/trips/${tripId}/invitations`, { requiresApproval: false });
      assert.equal(invitation.statusCode, 201, invitation.body);
      const joined = await request(1, 'POST', '/v1/invitations/accept', { token: invitation.json().invitation.token });
      assert.equal(joined.statusCode, 200, joined.body);
      assert.equal(joined.json().status, 'accepted');
      const activity = await request(0, 'POST', `/v1/trips/${tripId}/activities`, { title: 'Beach morning' });
      assert.equal(activity.statusCode, 201, activity.body);
      activityId = activity.json().activity.id as string;

      const typed = await database.query<{ data_type: string }>(`SELECT data_type FROM information_schema.columns
        WHERE table_name='goa_core_activity_comments' AND column_name='created_at'`);
      assert.equal(typed[0]!.data_type, 'timestamp with time zone');

      const beforeWrites = (await database.query<{ hits: number }>("SELECT hits FROM goa_core_rate_limits WHERE scope='comment-write'"))
        .reduce((sum, row) => sum + Number(row.hits), 0);
      const posted = await request(1, 'POST', url(), { body: '  Meet at the gate  ' });
      assert.equal(posted.statusCode, 201, posted.body);
      const riya = posted.json().comment as ActivityComment;
      riyaCommentId = riya.id;
      assert.equal(riya.tripId, tripId);
      assert.equal(riya.activityId, activityId);
      assert.equal(riya.authorId, ids[1]);
      assert.equal(riya.authorDisplayName, 'Riya');
      assert.equal(riya.body, 'Meet at the gate');
      assert.match(riya.createdAt, isoTimestamp);
      assert.match(riya.updatedAt, isoTimestamp);
      assert.deepEqual(Object.keys(riya).sort(), ['activityId', 'authorDisplayName', 'authorId', 'body', 'createdAt', 'id', 'tripId', 'updatedAt']);
      const createdAudit = await database.query<{ target_id: string; target_key: string | null }>('SELECT target_id, target_key FROM goa_core_audit WHERE trip_id=$1 AND action=$2 AND target_id=$3', [tripId, 'comment.created', riyaCommentId]);
      assert.equal(createdAudit.length, 1);
      assert.equal(createdAudit[0]!.target_id, riyaCommentId);
      assert.equal(createdAudit[0]!.target_key, null);

      const aman = await request(0, 'POST', url(), { body: 'Bring water' });
      assert.equal(aman.statusCode, 201, aman.body);
      amanCommentId = aman.json().comment.id as string;
      assert.equal(aman.json().comment.authorDisplayName, 'Aman');
      assert.equal(aman.json().comment.authorId, ids[0]);
      const afterWrites = (await database.query<{ hits: number }>("SELECT hits FROM goa_core_rate_limits WHERE scope='comment-write'"))
        .reduce((sum, row) => sum + Number(row.hits), 0);
      assert.ok(afterWrites >= beforeWrites + 2);
      const seen = await request(0, 'GET', url());
      assert.equal(seen.statusCode, 200, seen.body);
      const afterRead = (await database.query<{ hits: number }>("SELECT hits FROM goa_core_rate_limits WHERE scope='comment-write'"))
        .reduce((sum, row) => sum + Number(row.hits), 0);
      assert.equal(afterRead, afterWrites);
      assert.deepEqual((seen.json().comments as ActivityComment[]).map((comment) => comment.id), [riyaCommentId, amanCommentId]);

      const edited = await request(1, 'PATCH', `${url()}/${riyaCommentId}`, { body: "  Meet at the gate — don't wait  " });
      assert.equal(edited.statusCode, 200, edited.body);
      assert.equal(edited.json().comment.id, riyaCommentId);
      assert.equal(edited.json().comment.body, "Meet at the gate — don't wait");
      assert.equal(edited.json().comment.authorId, ids[1]);
      assert.match(edited.json().comment.updatedAt, isoTimestamp);
      const updatedAudit = await database.query<{ target_key: string | null }>('SELECT target_key FROM goa_core_audit WHERE trip_id=$1 AND action=$2 AND target_id=$3', [tripId, 'comment.updated', riyaCommentId]);
      assert.equal(updatedAudit.length, 1);
      assert.equal(updatedAudit[0]!.target_key, null);

      const auditsBefore = (await database.query('SELECT id FROM goa_core_audit WHERE action=$1', ['comment.updated'])).length;
      const memberEdit = await request(1, 'PATCH', `${url()}/${amanCommentId}`, { body: 'Riya rewrites Aman' });
      assert.equal(memberEdit.statusCode, 403, memberEdit.body);
      assert.equal(memberEdit.json().error.code, 'FORBIDDEN');
      const organiserEdit = await request(0, 'PATCH', `${url()}/${riyaCommentId}`, { body: 'Aman rewrites Riya' });
      assert.equal(organiserEdit.statusCode, 403, organiserEdit.body);
      assert.equal(organiserEdit.json().error.code, 'FORBIDDEN');
      assert.equal((await database.query('SELECT id FROM goa_core_audit WHERE action=$1', ['comment.updated'])).length, auditsBefore);
      const unchanged = await listed(0);
      assert.equal(unchanged.find((comment) => comment.id === amanCommentId)?.body, 'Bring water');
      assert.equal(unchanged.find((comment) => comment.id === riyaCommentId)?.body, "Meet at the gate — don't wait");

      const memberDelete = await request(1, 'DELETE', `${url()}/${amanCommentId}`);
      assert.equal(memberDelete.statusCode, 403, memberDelete.body);
      assert.equal(memberDelete.json().error.code, 'FORBIDDEN');
      assert.equal((await listed(0)).some((comment) => comment.id === amanCommentId), true);

      const retry = randomUUID();
      const firstCopy = await request(1, 'POST', url(), { body: 'First copy' }, { 'idempotency-key': retry });
      const secondCopy = await request(1, 'POST', url(), { body: 'Second copy' }, { 'idempotency-key': retry });
      assert.equal(firstCopy.statusCode, 201, firstCopy.body);
      assert.equal(secondCopy.statusCode, 201, secondCopy.body);
      assert.notEqual(firstCopy.json().comment.id, secondCopy.json().comment.id);
      assert.equal((await request(1, 'DELETE', `${url()}/${firstCopy.json().comment.id}`)).statusCode, 204);
      assert.equal((await request(1, 'DELETE', `${url()}/${secondCopy.json().comment.id}`)).statusCode, 204);
    });

    await t.test('the organiser deletes another member comment and it leaves the list', async () => {
      assert.equal((await request(0, 'DELETE', `${url()}/${riyaCommentId}`, { body: 'nope' })).statusCode, 400);
      const removed = await request(0, 'DELETE', `${url()}/${riyaCommentId}`);
      assert.equal(removed.statusCode, 204, removed.body);
      assert.equal(removed.body, '');
      const visible = await listed(1);
      assert.equal(visible.some((comment) => comment.id === riyaCommentId), false);
      assert.deepEqual(visible.map((comment) => comment.id), [amanCommentId]);
      const row = await database.query<{ deleted_at: Date | null }>('SELECT deleted_at FROM goa_core_activity_comments WHERE id=$1', [riyaCommentId]);
      assert.equal(row.length, 1);
      assert.ok(row[0]!.deleted_at);
      const deletedAudit = await database.query<{ target_id: string; target_key: string | null }>('SELECT target_id, target_key FROM goa_core_audit WHERE action=$1 AND target_id=$2', ['comment.deleted', riyaCommentId]);
      assert.equal(deletedAudit.length, 1);
      assert.equal(deletedAudit[0]!.target_key, null);
      assert.equal((await request(0, 'PATCH', `${url()}/${riyaCommentId}`, { body: 'Still here' })).statusCode, 404);
      assert.equal((await request(0, 'DELETE', `${url()}/${riyaCommentId}`)).statusCode, 404);
      assert.equal((await request(1, 'GET', url())).json().comments.some((comment: ActivityComment) => comment.id === riyaCommentId), false);
    });

    await t.test('the author deletes their own comment and a whitespace body creates nothing', async () => {
      const own = await request(1, 'POST', url(), { body: 'I will bring the tickets' });
      assert.equal(own.statusCode, 201, own.body);
      const ownId = own.json().comment.id as string;
      assert.equal((await request(1, 'DELETE', `${url()}/${ownId}`)).statusCode, 204);
      const visible = await listed(0);
      assert.equal(visible.some((comment) => comment.id === ownId), false);
      assert.equal((await database.query('SELECT id FROM goa_core_activity_comments WHERE id=$1 AND deleted_at IS NOT NULL', [ownId])).length, 1);
      const ownAudit = await database.query<{ target_key: string | null }>('SELECT target_key FROM goa_core_audit WHERE action=$1 AND target_id=$2', ['comment.deleted', ownId]);
      assert.equal(ownAudit.length, 1);
      assert.equal(ownAudit[0]!.target_key, null);

      const before = await commentCount();
      for (const body of [' ', '   ', '\n\t ']) {
        const rejected = await request(1, 'POST', url(), { body });
        assert.equal(rejected.statusCode, 400, rejected.body);
        assert.equal(rejected.json().error.code, 'VALIDATION_ERROR');
        assert.equal(rejected.json().error.message, 'Write a comment.');
      }
      const blankEdit = await request(0, 'PATCH', `${url()}/${amanCommentId}`, { body: ' \n ' });
      assert.equal(blankEdit.statusCode, 400, blankEdit.body);
      assert.equal(blankEdit.json().error.message, 'Write a comment.');
      assert.equal(await commentCount(), before);
      assert.equal((await listed(0)).find((comment) => comment.id === amanCommentId)?.body, 'Bring water');
      const spoofed = await request(1, 'POST', url(), { body: 'Mine', authorId: ids[0], authorDisplayName: 'Aman' });
      assert.equal(spoofed.statusCode, 400, spoofed.body);
      assert.equal(await commentCount(), before);
    });

    await t.test('Dev and a removed member get the same unavailable response', async () => {
      const hidden = async (index: number) => {
        const known = await request(index, 'GET', url());
        const unknown = await request(index, 'GET', `/v1/trips/${randomUUID()}/activities/${activityId}/comments`);
        assert.equal(known.statusCode, 404, known.body);
        assert.deepEqual(known.json(), unknown.json());
        assert.equal(known.json().error.code, 'NOT_FOUND');
        assert.equal(known.json().error.message, 'That resource is unavailable.');
        const before = await commentCount();
        assert.equal((await request(index, 'POST', url(), { body: 'Hidden note' })).statusCode, 404);
        assert.equal((await request(index, 'PATCH', `${url()}/${amanCommentId}`, { body: 'Hidden edit' })).statusCode, 404);
        assert.equal((await request(index, 'DELETE', `${url()}/${amanCommentId}`)).statusCode, 404);
        assert.equal(await commentCount(), before);
        assert.equal((await listed(0)).find((comment) => comment.id === amanCommentId)?.body, 'Bring water');
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
      assert.equal((await listed(0)).some((comment) => comment.id === amanCommentId), true);
    });

    await t.test('a missing comment or a missing activity is unavailable', async () => {
      const missingComment = randomUUID();
      assert.equal((await request(0, 'PATCH', `${url()}/${missingComment}`, { body: 'Nobody' })).statusCode, 404);
      assert.equal((await request(0, 'DELETE', `${url()}/${missingComment}`)).statusCode, 404);
      const otherActivity = await request(0, 'POST', `/v1/trips/${tripId}/activities`, { title: 'Evening walk' });
      assert.equal(otherActivity.statusCode, 201, otherActivity.body);
      const otherId = otherActivity.json().activity.id as string;
      assert.equal((await request(0, 'PATCH', `${url(otherId)}/${amanCommentId}`, { body: 'Wrong activity' })).statusCode, 404);
      assert.equal((await listed(0)).find((comment) => comment.id === amanCommentId)?.body, 'Bring water');
      const absent = randomUUID();
      assert.equal((await request(0, 'GET', url(absent))).statusCode, 404);
      assert.equal((await request(0, 'POST', url(absent), { body: 'No activity' })).statusCode, 404);
      assert.equal((await request(0, 'DELETE', `/v1/trips/${tripId}/activities/${otherId}`)).statusCode, 204);
      const farewell = await commentCount();
      assert.equal((await request(0, 'GET', url(otherId))).statusCode, 404);
      assert.equal((await request(0, 'POST', url(otherId), { body: 'On a deleted plan' })).statusCode, 404);
      assert.equal(await commentCount(), farewell);
      assert.equal((await request(0, 'GET', url())).statusCode, 200);
    });
  } finally {
    if (app) await app.close();
    await database.close();
    assert.ok(resolve(directory).startsWith(resolve(testRoot) + sep));
    await rm(directory, { recursive: true, force: true });
  }
});
