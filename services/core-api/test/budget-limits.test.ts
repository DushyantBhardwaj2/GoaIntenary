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

const secret = 'budget-limit-synthetic-test-secret-32-bytes';
const ids = ['10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003'];
function token(index: number): string {
  const encoded = Buffer.from(JSON.stringify({ sub: ids[index],displayName: ['Aman','Riya','Dev'][index],email: ['aman','riya','dev'][index] + '@example.invalid',exp: Math.floor(Date.now()/1000)+3600 })).toString('base64url');
  return `local.${encoded}.${createHmac('sha256',secret).update(`local.${encoded}`).digest('base64url')}`;
}
const input = { name: 'Manual Goa planner',startDate: '2026-12-04',endDate: '2026-12-06',region: 'north',travellerCount: 4,budgetPaise: 2_000_000,styles: ['beaches','food'] };
const budgetKeys = ['actualPerPersonPaise','actualTotalPaise','budgetPaise','categoryTotals','estimatedPerPersonPaise','expenses','forecastRemainingPaise','plannedTotalPaise','remainingPaise'];

test('category spending limits stay display caps beside the paid and forecast balances', async (t) => {
  const testRoot = fileURLToPath(new URL('../../../.data/tests/',import.meta.url));
  await mkdir(testRoot,{ recursive: true });
  const directory = await mkdtemp(join(testRoot,'goa-budget-limits-test-'));
  const config = loadConfig({ NODE_ENV: 'test',ENABLE_LOCAL_DEMO: 'true',LOCAL_SESSION_SECRET: secret,PGLITE_DATA_DIR: directory });
  const database = await openDatabase(config);
  let app: FastifyInstance | undefined;
  try {
    app = await buildApp({ config,database,logger: false });
    const request = (index: number | null,method: InjectOptions['method'],url: string,payload?: unknown,headers: Record<string,string> = {}) => app!.inject({
      method,url,headers: { ...(payload !== undefined ? { 'content-type': 'application/json' } : {}),...headers,...(index === null ? {} : { authorization: `Bearer ${token(index)}` }) },
      ...(payload !== undefined ? { payload: JSON.stringify(payload) } : {}),
    });
    let tripId = '';
    const limitsUrl = () => `/v1/trips/${tripId}/budget/category-limits`;
    const budgetUrl = () => `/v1/trips/${tripId}/budget`;
    const storedLimit = async (category: string) => {
      const [row] = await database.query<{ limit_paise: string | number }>(
        'SELECT limit_paise FROM goa_core_budget_category_limits WHERE trip_id=$1 AND category=$2', [tripId,category]);
      return row ? Number(row.limit_paise) : null;
    };
    const auditRows = () => database.query<{ target_id: string; target_key: string | null }>(
      `SELECT target_id, target_key FROM goa_core_audit WHERE trip_id=$1 AND action='budget_limit.updated'`, [tripId]);
    const writeHits = async () => (await database.query<{ hits: string | number }>(
      "SELECT hits FROM goa_core_rate_limits WHERE scope='budget-limit-write'")).reduce((sum, row) => sum + Number(row.hits), 0);
    const category = (budget: { categoryTotals: { category: string; limitPaise: number | null; plannedPaise: number; actualPaise: number }[] }, name: string) => {
      const row = budget.categoryTotals.find((item) => item.category === name);
      assert.ok(row, name);
      return row;
    };

    await t.test('the organiser sets an accommodation limit and an unset category stays null', async () => {
      const created = await request(0,'POST','/v1/trips',input);
      assert.equal(created.statusCode,201,created.body);
      tripId = created.json().trip.id as string;
      const invitation = await request(0,'POST',`/v1/trips/${tripId}/invitations`,{ requiresApproval: false });
      assert.equal(invitation.statusCode,201,invitation.body);
      const joined = await request(1,'POST','/v1/invitations/accept',{ token: invitation.json().invitation.token });
      assert.equal(joined.statusCode,200,joined.body);
      assert.equal(joined.json().status,'accepted');

      const before = await writeHits();
      const saved = await request(0,'PUT',limitsUrl(),{ limits: [{ category: 'accommodation', limitPaise: 750_000 }] });
      assert.equal(saved.statusCode,200,saved.body);
      assert.deepEqual(saved.json().limits,[{ category: 'accommodation', limitPaise: 750_000 }]);
      assert.ok(await writeHits() >= before + 1);
      const reads = await writeHits();
      const budget = (await request(0,'GET',budgetUrl())).json();
      assert.equal(await writeHits(),reads);
      assert.equal(category(budget,'accommodation').limitPaise,750_000);
      assert.equal(category(budget,'transport').limitPaise,null);
      assert.equal(await storedLimit('accommodation'),750_000);
      assert.equal(await storedLimit('transport'),null);
    });

    await t.test('an accepted member cannot change the stored limit', async () => {
      const audits = (await auditRows()).length;
      const denied = await request(1,'PUT',limitsUrl(),{ limits: [{ category: 'accommodation', limitPaise: 1 }] });
      assert.equal(denied.statusCode,403,denied.body);
      assert.equal(denied.json().error.code,'FORBIDDEN');
      assert.equal(await storedLimit('accommodation'),750_000);
      assert.equal((await auditRows()).length,audits);
    });

    await t.test('a pending member and an outsider are told the budget is unavailable', async () => {
      const outsiderPut = await request(2,'PUT',limitsUrl(),{ limits: [{ category: 'accommodation', limitPaise: 2 }] });
      const outsiderGet = await request(2,'GET',budgetUrl());
      const unknownId = randomUUID();
      const unknownGet = await request(2,'GET',`/v1/trips/${unknownId}/budget`);
      assert.equal(outsiderPut.statusCode,404,outsiderPut.body);
      assert.equal(outsiderGet.statusCode,404,outsiderGet.body);
      assert.deepEqual(outsiderGet.json(),unknownGet.json());
      assert.equal(outsiderGet.json().error.message,'That resource is unavailable.');
      assert.equal(await storedLimit('accommodation'),750_000);

      const pendingInvite = await request(0,'POST',`/v1/trips/${tripId}/invitations`,{});
      assert.equal(pendingInvite.statusCode,201,pendingInvite.body);
      const pending = await request(2,'POST','/v1/invitations/accept',{ token: pendingInvite.json().invitation.token });
      assert.equal(pending.json().status,'pending');
      const pendingPut = await request(2,'PUT',limitsUrl(),{ limits: [{ category: 'food', limitPaise: 3 }] });
      const pendingGet = await request(2,'GET',budgetUrl());
      assert.equal(pendingPut.statusCode,404,pendingPut.body);
      assert.equal(pendingGet.statusCode,404,pendingGet.body);
      assert.equal(pendingGet.json().error.code,'NOT_FOUND');
      assert.equal(await storedLimit('accommodation'),750_000);
      assert.equal(await storedLimit('food'),null);
    });

    await t.test('omitted categories stay stored, invalid caps can be retried, and amounts are not audited', async () => {
      const food = await request(0,'PUT',limitsUrl(),{ limits: [{ category: 'food', limitPaise: 1_000 }] });
      assert.equal(food.statusCode,200,food.body);
      assert.deepEqual(food.json().limits,[{ category: 'food', limitPaise: 1_000 }]);
      assert.equal(await storedLimit('accommodation'),750_000);
      assert.equal(await storedLimit('food'),1_000);

      const audits = (await auditRows()).length;
      const empty = await request(0,'PUT',limitsUrl(),{ limits: [] });
      assert.equal(empty.statusCode,200,empty.body);
      assert.deepEqual(empty.json().limits,[]);
      assert.equal(await storedLimit('food'),1_000);
      assert.equal((await auditRows()).length,audits);

      const rejected = await request(0,'PUT',limitsUrl(),{ limits: [{ category: 'accommodation', limitPaise: 1_000_000_001 }] });
      assert.equal(rejected.statusCode,400,rejected.body);
      assert.equal(await storedLimit('accommodation'),750_000);
      const retried = await request(0,'PUT',limitsUrl(),{ limits: [{ category: 'accommodation', limitPaise: 750_000 }] });
      assert.equal(retried.statusCode,200,retried.body);
      assert.equal(retried.json().limits[0].limitPaise,750_000);

      const zero = await request(0,'PUT',limitsUrl(),{ limits: [{ category: 'other', limitPaise: 0 }] });
      assert.equal(zero.statusCode,200,zero.body);
      assert.equal(zero.json().limits[0].limitPaise,0);
      assert.equal(await storedLimit('other'),0);

      const doubled = await request(0,'PUT',limitsUrl(),{ limits: [{ category: 'shopping', limitPaise: 10 },{ category: 'shopping', limitPaise: 20 }] });
      assert.equal(doubled.statusCode,200,doubled.body);
      assert.deepEqual(doubled.json().limits,[{ category: 'shopping', limitPaise: 20 }]);
      const shoppingRows = await database.query('SELECT category FROM goa_core_budget_category_limits WHERE trip_id=$1 AND category=$2',[tripId,'shopping']);
      assert.equal(shoppingRows.length,1);

      const key = randomUUID();
      const first = await request(0,'PUT',limitsUrl(),{ limits: [{ category: 'activities', limitPaise: 40 }] },{ 'idempotency-key': key });
      const second = await request(0,'PUT',limitsUrl(),{ limits: [{ category: 'activities', limitPaise: 50 }] },{ 'idempotency-key': key });
      assert.equal(first.statusCode,200,first.body);
      assert.equal(second.statusCode,200,second.body);
      assert.equal(second.json().limits[0].limitPaise,50);
      assert.equal(await storedLimit('activities'),50);
      assert.equal(await storedLimit('transport'),null);
      const scoped = await database.query(`SELECT scope FROM goa_core_write_idempotency WHERE trip_id=$1 AND scope LIKE '%budget%'`,[tripId]);
      assert.equal(scoped.length,0);

      const auditsAfter = await auditRows();
      assert.ok(auditsAfter.length >= 1);
      for (const row of auditsAfter) {
        assert.equal(row.target_id,tripId);
        assert.equal(row.target_key,null);
      }
    });

    await t.test('paid remaining and forecast remaining use the trip budget separately', async () => {
      const activity = await request(0,'POST',`/v1/trips/${tripId}/activities`,{ title: 'Beach morning',day: '2026-12-04',category: 'beach',estimatedCostPaise: 800_000 });
      assert.equal(activity.statusCode,201,activity.body);
      const expense = await request(1,'POST',`/v1/trips/${tripId}/expenses`,{ title: 'Lunch paid',amountPaise: 125_000,category: 'food',date: '2026-12-05' });
      assert.equal(expense.statusCode,201,expense.body);
      assert.equal(expense.json().expense.amountPaise,125_000);

      const response = await request(0,'GET',budgetUrl());
      assert.equal(response.statusCode,200,response.body);
      const budget = response.json();
      assert.deepEqual(Object.keys(budget).sort(),budgetKeys);
      assert.deepEqual({
        budgetPaise: budget.budgetPaise,plannedTotalPaise: budget.plannedTotalPaise,actualTotalPaise: budget.actualTotalPaise,
        remainingPaise: budget.remainingPaise,forecastRemainingPaise: budget.forecastRemainingPaise,
        estimatedPerPersonPaise: budget.estimatedPerPersonPaise,actualPerPersonPaise: budget.actualPerPersonPaise,
      },{
        budgetPaise: 2_000_000,plannedTotalPaise: 800_000,actualTotalPaise: 125_000,
        remainingPaise: 1_875_000,forecastRemainingPaise: 1_200_000,
        estimatedPerPersonPaise: 200_000,actualPerPersonPaise: 31_250,
      });
      assert.notEqual(budget.forecastRemainingPaise,2_000_000 - 800_000 - 125_000);
      assert.equal(budget.expenses.length,1);
      assert.equal(category(budget,'activities').plannedPaise,800_000);
      assert.equal(category(budget,'food').actualPaise,125_000);
      assert.equal(category(budget,'food').limitPaise,1_000);
      assert.equal(category(budget,'accommodation').limitPaise,750_000);
      assert.equal(category(budget,'transport').limitPaise,null);
      assert.equal(category(budget,'other').limitPaise,0);
      assert.deepEqual(Object.keys(category(budget,'transport')).sort(),['actualPaise','category','limitPaise','plannedPaise']);
      assert.equal(budget.categoryTotals.length,6);
    });

    await t.test('a removed member cannot read the budget or change a limit', async () => {
      assert.equal((await request(0,'POST',`/v1/trips/${tripId}/members/${ids[2]}/approve`)).statusCode,200);
      assert.equal((await request(0,'DELETE',`/v1/trips/${tripId}/members/${ids[2]}`)).statusCode,204);
      const removedMember = (await database.query<{ status: string }>('SELECT status FROM goa_core_memberships WHERE trip_id=$1 AND user_id=$2',[tripId,ids[2]]))[0]!;
      assert.equal(removedMember.status,'removed');
      const before = await storedLimit('accommodation');
      const removedPut = await request(2,'PUT',limitsUrl(),{ limits: [{ category: 'accommodation', limitPaise: 9 }] });
      const removedGet = await request(2,'GET',budgetUrl());
      const unknownGet = await request(2,'GET',`/v1/trips/${randomUUID()}/budget`);
      assert.equal(removedPut.statusCode,404,removedPut.body);
      assert.equal(removedGet.statusCode,404,removedGet.body);
      assert.deepEqual(removedGet.json(),unknownGet.json());
      assert.equal(removedGet.json().error.code,'NOT_FOUND');
      assert.equal(await storedLimit('accommodation'),before);
      const still = (await request(0,'GET',budgetUrl())).json();
      assert.equal(still.remainingPaise,1_875_000);
      assert.equal(still.forecastRemainingPaise,1_200_000);
      assert.equal(category(still,'accommodation').limitPaise,750_000);
    });
  } finally {
    if (app) await app.close();
    await database.close();
    assert.ok(resolve(directory).startsWith(resolve(testRoot)+sep));
    await rm(directory,{ recursive: true,force: true });
  }
});
