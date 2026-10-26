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
import type { ChecklistItem } from '../src/trip-planning-types.js';

const secret = 'checklist-synthetic-test-secret-32-bytes';
const ids = ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003'];
function token(index: number): string {
  const encoded = Buffer.from(JSON.stringify({ sub: ids[index], displayName: ['Aman', 'Riya', 'Dev'][index], email: ['aman', 'riya', 'dev'][index] + '@example.invalid', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  return `local.${encoded}.${createHmac('sha256', secret).update(`local.${encoded}`).digest('base64url')}`;
}
const input = { name: 'Manual Goa planner', startDate: '2026-12-04', endDate: '2026-12-06', region: 'north', travellerCount: 4, budgetPaise: 2_000_000, styles: ['beaches', 'food'] };

test('checklists keep personal items private and let accepted members share tasks', async (t) => {
  const testRoot = fileURLToPath(new URL('../../../.data/tests/', import.meta.url));
  await mkdir(testRoot, { recursive: true });
  const directory = await mkdtemp(join(testRoot, 'goa-checklist-test-'));
  const config = loadConfig({ NODE_ENV: 'test', ENABLE_LOCAL_DEMO: 'true', LOCAL_SESSION_SECRET: secret, PGLITE_DATA_DIR: directory });
  let database = await openDatabase(config);
  let app: FastifyInstance | undefined;
  try {
    await migrate(database);
    app = await buildApp({ config, database, runMigrations: false, logger: false });
    const request = (index: number | null, method: InjectOptions['method'], url: string, payload?: unknown, headers: Record<string, string> = {}) => app!.inject({
      method, url, headers: { ...(payload !== undefined ? { 'content-type': 'application/json' } : {}), ...headers, ...(index === null ? {} : { authorization: `Bearer ${token(index)}` }) },
      ...(payload !== undefined ? { payload: JSON.stringify(payload) } : {}),
    });
    let tripId = '';
    let sunscreen: ChecklistItem | undefined;
    let torch: ChecklistItem | undefined;
    let cab: ChecklistItem | undefined;
    const checklist = () => `/v1/trips/${tripId}/checklist`;
    const itemUrl = (id: string) => `${checklist()}/${id}`;
    const listed = async (index: number) => {
      const response = await request(index, 'GET', checklist());
      assert.equal(response.statusCode, 200, response.body);
      return response.json().items as ChecklistItem[];
    };
    const audits = (id: string) => database.query<{ action: string; target_key: string | null }>(
      `SELECT action, target_key FROM goa_core_audit WHERE target_id=$1 AND action LIKE 'checklist.%'`, [id]);

    await t.test('an outsider and a pending member get 404 before any checklist decision', async () => {
      const created = await request(0, 'POST', '/v1/trips', input);
      assert.equal(created.statusCode, 201, created.body);
      tripId = created.json().trip.id;
      const personal = await request(0, 'POST', checklist(), { visibility: 'personal', title: '  Aman sunscreen  ' });
      assert.equal(personal.statusCode, 201, personal.body);
      sunscreen = personal.json().item as ChecklistItem;
      assert.equal(sunscreen.visibility, 'personal');
      assert.equal(sunscreen.title, 'Aman sunscreen');
      assert.equal(sunscreen.assigneeUserId, null);
      assert.equal(sunscreen.completedAt, null);
      assert.equal(sunscreen.createdBy, ids[0]);
      assert.equal(sunscreen.tripId, tripId);
      assert.equal(Number.isNaN(Date.parse(sunscreen.createdAt)), false);
      assert.ok(sunscreen.createdAt.endsWith('Z'));

      for (const call of [
        request(2, 'GET', checklist()),
        request(2, 'POST', checklist(), { visibility: 'personal', title: 'Dev torch' }),
        request(2, 'POST', checklist(), { visibility: 'personal', title: '   ' }),
        request(2, 'PATCH', itemUrl(sunscreen.id), { completedAt: 'yesterday' }),
        request(2, 'DELETE', itemUrl(sunscreen.id)),
      ]) {
        const response = await call;
        assert.equal(response.statusCode, 404, response.body);
        assert.equal(response.json().error.code, 'NOT_FOUND');
      }
      assert.equal((await listed(0)).some((item) => item.id === sunscreen!.id && item.title === 'Aman sunscreen'), true);

      const invitation = await request(0, 'POST', `/v1/trips/${tripId}/invitations`, { requiresApproval: true });
      assert.equal(invitation.statusCode, 201, invitation.body);
      const pending = await request(1, 'POST', '/v1/invitations/accept', { token: invitation.json().invitation.token });
      assert.equal(pending.statusCode, 200, pending.body);
      assert.equal(pending.json().status, 'pending');
      for (const call of [
        request(1, 'GET', checklist()),
        request(1, 'POST', checklist(), { visibility: 'personal', title: '   ' }),
        request(1, 'POST', checklist(), { visibility: 'shared', title: 'Too early', assigneeUserId: ids[0] }),
        request(1, 'PATCH', itemUrl(sunscreen.id), { title: 'Seen' }),
        request(1, 'DELETE', itemUrl(sunscreen.id)),
      ]) {
        const response = await call;
        assert.equal(response.statusCode, 404, response.body);
      }
      const assignedPending = await request(0, 'POST', checklist(), { visibility: 'shared', title: 'Too early', assigneeUserId: ids[1] });
      assert.equal(assignedPending.statusCode, 400, assignedPending.body);
      assert.match(assignedPending.json().error.message, /accepted/i);
      const assignedOutsider = await request(0, 'POST', checklist(), { visibility: 'shared', title: 'Unknown person', assigneeUserId: ids[2] });
      assert.equal(assignedOutsider.statusCode, 400, assignedOutsider.body);
      const personalAssignee = await request(0, 'POST', checklist(), { visibility: 'personal', title: 'Meds', assigneeUserId: ids[1] });
      assert.equal(personalAssignee.statusCode, 400, personalAssignee.body);
      assert.match(personalAssignee.json().error.message, /personal/i);
      assert.equal((await request(0, 'POST', checklist(), { visibility: 'personal', title: '' })).statusCode, 400);
      assert.deepEqual((await listed(0)).map((item) => item.id), [sunscreen.id]);
    });

    await t.test('personal items stay with their creator, including from the organiser', async () => {
      const approved = await request(0, 'POST', `/v1/trips/${tripId}/members/${ids[1]}/approve`);
      assert.equal(approved.statusCode, 200, approved.body);
      const riyaView = await listed(1);
      assert.equal(riyaView.some((item) => item.id === sunscreen!.id), false);
      assert.equal(JSON.stringify(riyaView).includes('Aman sunscreen'), false);
      const amanView = await listed(0);
      assert.equal(amanView.some((item) => item.id === sunscreen!.id), true);

      const created = await request(1, 'POST', checklist(), { visibility: 'personal', title: 'Riya private torch' });
      assert.equal(created.statusCode, 201, created.body);
      const torchItem = created.json().item as ChecklistItem;
      torch = torchItem;
      assert.equal(torchItem.createdBy, ids[1]);
      assert.equal(torchItem.assigneeUserId, null);
      const organiserView = await request(0, 'GET', checklist());
      assert.equal(organiserView.statusCode, 200, organiserView.body);
      assert.equal(organiserView.body.includes('Riya private torch'), false);
      assert.equal(organiserView.json().items.some((item: ChecklistItem) => item.id === torchItem.id), false);
      assert.equal((await listed(1)).some((item) => item.id === torchItem.id && item.title === 'Riya private torch'), true);

      const hiddenPatch = await request(0, 'PATCH', itemUrl(torchItem.id), { completedAt: 'yesterday' });
      assert.equal(hiddenPatch.statusCode, 404, hiddenPatch.body);
      assert.equal(hiddenPatch.body.includes('Riya private torch'), false);
      const hiddenDelete = await request(0, 'DELETE', itemUrl(torchItem.id));
      assert.equal(hiddenDelete.statusCode, 404, hiddenDelete.body);
      assert.equal((await listed(1)).some((item) => item.id === torchItem.id && item.title === 'Riya private torch'), true);
      const renamed = await request(1, 'PATCH', itemUrl(torchItem.id), { title: '  Riya private torch  ' });
      assert.equal(renamed.statusCode, 200, renamed.body);
      assert.equal(renamed.json().item.title, 'Riya private torch');
      assert.equal(renamed.json().item.visibility, 'personal');
    });

    await t.test('a shared item assigned to Riya can be completed and stays visible to both', async () => {
      const created = await request(0, 'POST', checklist(), { visibility: 'shared', title: 'Book the cab', assigneeUserId: ids[1] });
      assert.equal(created.statusCode, 201, created.body);
      cab = created.json().item as ChecklistItem;
      assert.equal(cab.assigneeUserId, ids[1]);
      assert.equal(cab.visibility, 'shared');
      assert.equal(cab.completedAt, null);
      assert.equal((await listed(0)).some((item) => item.id === cab!.id), true);
      assert.equal((await listed(1)).some((item) => item.id === cab!.id), true);
      assert.equal((await request(2, 'GET', checklist())).statusCode, 404);

      const doneAt = '2026-12-04T10:15:00.000Z';
      const completed = await request(1, 'PATCH', itemUrl(cab.id), { completedAt: doneAt });
      assert.equal(completed.statusCode, 200, completed.body);
      assert.equal(completed.json().item.completedAt, doneAt);
      assert.equal(completed.json().item.title, 'Book the cab');
      for (const index of [0, 1]) {
        const visible = (await listed(index)).find((item) => item.id === cab!.id);
        assert.ok(visible);
        assert.equal(visible.completedAt, doneAt);
        assert.equal(visible.visibility, 'shared');
      }
      const rows = await audits(cab.id);
      assert.deepEqual(rows.map((row) => row.action).sort(), ['checklist.completed', 'checklist.created']);
      assert.ok(rows.every((row) => row.target_key === null));
      const shifted = await request(1, 'PATCH', itemUrl(cab.id), { completedAt: '2026-12-04T15:45:00+05:30' });
      assert.equal(shifted.statusCode, 200, shifted.body);
      assert.equal(shifted.json().item.completedAt, '2026-12-04T10:15:00.000Z');
      assert.equal((await request(1, 'PATCH', itemUrl(cab.id), { completedAt: 'yesterday' })).statusCode, 400);
      assert.equal((await request(1, 'PATCH', itemUrl(cab.id), { completedAt: '2026-02-31T00:00:00.000Z' })).statusCode, 400);
      assert.equal((await request(1, 'PATCH', itemUrl(cab.id), { completedAt: '2026-12-04T10:00:00' })).statusCode, 400);
      assert.equal((await listed(0)).find((item) => item.id === cab!.id)?.completedAt, doneAt);
      assert.equal((await listed(1)).find((item) => item.id === cab!.id)?.completedAt, doneAt);
    });

    await t.test('the same retry key returns the original item and a different body conflicts', async () => {
      const key = randomUUID();
      const body = { visibility: 'shared', title: 'Duplicate cab', assigneeUserId: ids[1] };
      const repeated = await Promise.all([
        request(0, 'POST', checklist(), body, { 'idempotency-key': key }),
        request(0, 'POST', checklist(), body, { 'idempotency-key': key }),
      ]);
      assert.deepEqual(repeated.map((response) => response.statusCode), [201, 201]);
      const first = repeated[0]!.json().item as ChecklistItem;
      assert.equal(repeated[1]!.json().item.id, first.id);
      assert.equal((await database.query('SELECT id FROM goa_core_checklist_items WHERE title=$1 AND deleted_at IS NULL', ['Duplicate cab'])).length, 1);
      const conflict = await request(0, 'POST', checklist(), { ...body, title: 'Different cab' }, { 'idempotency-key': key });
      assert.equal(conflict.statusCode, 409, conflict.body);
      assert.equal(conflict.json().error.code, 'CONFLICT');
      assert.equal((await database.query('SELECT id FROM goa_core_checklist_items WHERE title=$1', ['Different cab'])).length, 0);
      const sharedOpen = await request(0, 'POST', checklist(), { visibility: 'shared', title: 'Also unassigned' });
      assert.equal(sharedOpen.statusCode, 201, sharedOpen.body);
      assert.equal(sharedOpen.json().item.assigneeUserId, null);
      assert.equal((await request(0, 'PATCH', itemUrl(sunscreen!.id), { assigneeUserId: ids[1] })).statusCode, 400);
      assert.equal((await listed(0)).find((item) => item.id === sunscreen!.id)?.visibility, 'personal');
      assert.equal((await listed(0)).find((item) => item.id === sunscreen!.id)?.assigneeUserId, null);
      assert.equal((await request(0, 'PATCH', itemUrl(sunscreen!.id), { title: 'Aman sunscreen', visibility: 'shared' })).statusCode, 400);
      assert.equal((await request(0, 'PATCH', itemUrl(cab!.id), {})).statusCode, 400);
    });

    await t.test('list order is personal first, then open items, then when they were added', async () => {
      const sharedOpen = await request(0, 'POST', checklist(), { visibility: 'shared', title: 'Order shared open' });
      assert.equal(sharedOpen.statusCode, 201, sharedOpen.body);
      const personalDone = await request(0, 'POST', checklist(), { visibility: 'personal', title: 'Order personal done' });
      assert.equal(personalDone.statusCode, 201, personalDone.body);
      assert.equal((await request(0, 'PATCH', itemUrl(personalDone.json().item.id), { completedAt: '2026-12-05T08:00:00.000Z' })).statusCode, 200);
      const personalOpen = await request(0, 'POST', checklist(), { visibility: 'personal', title: 'Order personal open' });
      assert.equal(personalOpen.statusCode, 201, personalOpen.body);
      const sharedDone = await request(1, 'POST', checklist(), { visibility: 'shared', title: 'Order shared done', assigneeUserId: null });
      assert.equal(sharedDone.statusCode, 201, sharedDone.body);
      assert.equal((await request(0, 'PATCH', itemUrl(sharedDone.json().item.id), { completedAt: '2026-12-05T09:00:00.000Z' })).statusCode, 200);
      const titles = (await listed(0)).map((item) => item.title);
      const rank = (title: string) => {
        const index = titles.indexOf(title);
        assert.ok(index >= 0, title);
        return index;
      };
      assert.ok(rank('Order personal open') < rank('Order personal done'));
      assert.ok(rank('Order personal done') < rank('Order shared open'));
      assert.ok(rank('Order shared open') < rank('Order shared done'));
      assert.ok(rank('Aman sunscreen') < rank('Order personal done'));
      const riyaTitles = (await listed(1)).map((item) => item.title);
      const riyaRank = (title: string) => {
        const index = riyaTitles.indexOf(title);
        assert.ok(index >= 0, title);
        return index;
      };
      assert.equal(riyaTitles.includes('Order personal open'), false);
      assert.equal(riyaTitles.includes('Aman sunscreen'), false);
      assert.ok(riyaRank('Riya private torch') < riyaRank('Order shared open'));
      assert.ok(riyaRank('Order shared open') < riyaRank('Order shared done'));
    });

    await t.test('shared edits and completion follow creator, assignee, and organiser', async () => {
      const open = await request(0, 'POST', checklist(), { visibility: 'shared', title: 'Anyone can take this', assigneeUserId: null });
      assert.equal(open.statusCode, 201, open.body);
      const openId = open.json().item.id as string;
      assert.equal((await request(1, 'PATCH', itemUrl(openId), { completedAt: '2026-12-05T12:00:00.000Z' })).statusCode, 403);
      assert.equal((await request(1, 'PATCH', itemUrl(openId), { title: 'Renamed by Riya' })).statusCode, 403);
      assert.equal((await request(1, 'DELETE', itemUrl(openId))).statusCode, 403);
      assert.equal((await listed(1)).find((item) => item.id === openId)?.title, 'Anyone can take this');
      const marked = await request(0, 'PATCH', itemUrl(openId), { completedAt: '2026-12-05T12:00:00.000Z' });
      assert.equal(marked.statusCode, 200, marked.body);
      const cleared = await request(0, 'PATCH', itemUrl(openId), { completedAt: null });
      assert.equal(cleared.statusCode, 200, cleared.body);
      assert.equal(cleared.json().item.completedAt, null);
      const retitled = await request(0, 'PATCH', itemUrl(openId), { title: '  Still unassigned  ' });
      assert.equal(retitled.statusCode, 200, retitled.body);
      assert.equal(retitled.json().item.title, 'Still unassigned');
      const openAudits = await audits(openId);
      assert.ok(openAudits.every((row) => row.target_key === null));
      assert.equal(openAudits.filter((row) => row.action === 'checklist.created').length, 1);
      assert.equal(openAudits.filter((row) => row.action === 'checklist.completed').length, 1);
      assert.ok(openAudits.some((row) => row.action === 'checklist.updated'));
      assert.equal((await request(1, 'DELETE', itemUrl(openId))).statusCode, 403);
      assert.equal((await request(0, 'DELETE', itemUrl(openId))).statusCode, 204);
      assert.equal((await request(0, 'DELETE', itemUrl(openId))).statusCode, 404);
      assert.equal((await listed(0)).some((item) => item.id === openId), false);
      assert.equal((await listed(1)).some((item) => item.id === openId), false);
      const deletedAudit = await audits(openId);
      assert.equal(deletedAudit.filter((row) => row.action === 'checklist.deleted').length, 1);

      const riyaShared = await request(1, 'POST', checklist(), { visibility: 'shared', title: 'Riya shared note' });
      assert.equal(riyaShared.statusCode, 201, riyaShared.body);
      const riyaSharedId = riyaShared.json().item.id as string;
      assert.equal((await request(1, 'PATCH', itemUrl(riyaSharedId), { completedAt: '2026-12-05T13:00:00.000Z' })).statusCode, 403);
      assert.equal((await request(1, 'PATCH', itemUrl(riyaSharedId), { title: 'Riya renamed the note' })).json().item.title, 'Riya renamed the note');
      assert.equal((await request(0, 'PATCH', itemUrl(riyaSharedId), { title: 'Organiser renamed the note', assigneeUserId: ids[0] })).statusCode, 200);
      assert.equal((await request(1, 'DELETE', itemUrl(riyaSharedId))).statusCode, 204);
      const organiserDeletes = await request(1, 'POST', checklist(), { visibility: 'shared', title: 'Organiser can remove this', assigneeUserId: ids[1] });
      assert.equal(organiserDeletes.statusCode, 201, organiserDeletes.body);
      const removableId = organiserDeletes.json().item.id as string;
      assert.equal((await request(0, 'DELETE', itemUrl(removableId))).statusCode, 204);
      assert.equal((await listed(1)).some((item) => item.id === removableId), false);

      const spare = await request(1, 'POST', checklist(), { visibility: 'personal', title: 'Riya spare charger' });
      assert.equal(spare.statusCode, 201, spare.body);
      assert.equal((await request(1, 'PATCH', itemUrl(spare.json().item.id), { title: 'Riya spare battery', completedAt: '2026-12-05T14:00:00.000Z' })).statusCode, 200);
      assert.equal((await request(0, 'PATCH', itemUrl(spare.json().item.id), { title: 'Taken' })).statusCode, 404);
      assert.equal((await request(1, 'DELETE', itemUrl(spare.json().item.id))).statusCode, 204);
      assert.equal(JSON.stringify(await listed(0)).includes('Riya spare battery'), false);
      assert.equal((await listed(0)).find((item) => item.id === cab!.id)?.completedAt, '2026-12-04T10:15:00.000Z');
      assert.equal((await listed(1)).find((item) => item.id === cab!.id)?.completedAt, '2026-12-04T10:15:00.000Z');
    });

    await t.test('a removed member gets 404 and the organiser still misses their personal row', async () => {
      assert.equal((await request(0, 'DELETE', `/v1/trips/${tripId}/members/${ids[1]}`)).statusCode, 204);
      for (const call of [
        request(1, 'GET', checklist()),
        request(1, 'POST', checklist(), { visibility: 'personal', title: 'After removal' }),
        request(1, 'PATCH', itemUrl(torch!.id), { title: 'Still hidden' }),
        request(1, 'DELETE', itemUrl(cab!.id)),
        request(2, 'GET', checklist()),
      ]) {
        const response = await call;
        assert.equal(response.statusCode, 404, response.body);
      }
      const assignedRemoved = await request(0, 'POST', checklist(), { visibility: 'shared', title: 'Removed assignee', assigneeUserId: ids[1] });
      assert.equal(assignedRemoved.statusCode, 400, assignedRemoved.body);
      const amanItems = await listed(0);
      assert.equal(amanItems.some((item) => item.id === torch!.id), false);
      assert.equal(JSON.stringify(amanItems).includes('Riya private torch'), false);
      assert.equal(amanItems.find((item) => item.id === cab!.id)?.completedAt, '2026-12-04T10:15:00.000Z');
      const hidden = await database.query<{ visibility: string; created_by: string; deleted_at: Date | null }>(
        'SELECT visibility, created_by, deleted_at FROM goa_core_checklist_items WHERE id=$1', [torch!.id]);
      assert.equal(hidden[0]!.visibility, 'personal');
      assert.equal(hidden[0]!.created_by, ids[1]);
      assert.equal(hidden[0]!.deleted_at, null);
    });
  } finally {
    if (app) await app.close();
    await database.close();
    assert.ok(resolve(directory).startsWith(resolve(testRoot) + sep));
    await rm(directory, { recursive: true, force: true });
  }
});
