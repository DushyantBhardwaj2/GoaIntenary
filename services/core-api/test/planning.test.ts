import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { migrate, openDatabase } from '../src/database.js';
import { exactTotal, perPerson } from '../src/money.js';
import { hash } from '../src/repository.js';
import type { Activity, Expense, Trip } from '../src/types.js';

const secret = 'planning-synthetic-test-secret-with-32-bytes';
const ids = ['10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003'];
function token(index: number): string {
  const encoded = Buffer.from(JSON.stringify({ sub: ids[index],displayName: ['Aman','Riya','Dev'][index],email: ['aman','riya','dev'][index] + '@example.invalid',exp: Math.floor(Date.now()/1000)+3600 })).toString('base64url');
  return `local.${encoded}.${createHmac('sha256',secret).update(`local.${encoded}`).digest('base64url')}`;
}
const input = { name: 'Manual Goa planner',startDate: '2026-12-04',endDate: '2026-12-06',region: 'north',travellerCount: 4,budgetPaise: 2_000_000,styles: ['beaches','food'] };
const snapshot = { placeId: 'fort-aguada',title: 'Fort Aguada',category: 'culture',region: 'north',latitude: 15.492,longitude: 73.774,sourceUrl: 'https://goa-tourism.com/' };

test('money totals and approximate per-person values use exact integer rounding', () => {
  assert.equal(exactTotal([800_000,125_000,1]),925_001);
  assert.equal(perPerson(101,3),34);
  assert.equal(perPerson(1,2),1);
  assert.equal(perPerson(125_000,4),31_250);
  assert.throws(() => exactTotal([Number.MAX_SAFE_INTEGER,1]), { statusCode: 409 });
});

test('premium planner persists private itinerary and spending with additive migration', async (t) => {
  const testRoot = fileURLToPath(new URL('../../../.data/tests/',import.meta.url));
  await mkdir(testRoot,{ recursive: true });
  const directory = await mkdtemp(join(testRoot,'goa-planner-test-'));
  const config = loadConfig({ NODE_ENV: 'test',ENABLE_LOCAL_DEMO: 'true',LOCAL_SESSION_SECRET: secret,PGLITE_DATA_DIR: directory });
  let database = await openDatabase(config);
  let app: FastifyInstance | undefined;
  try {
    const legacyId = randomUUID();
    const legacyInviteId = randomUUID();
    const legacyToken = 'l'.repeat(43);
    await migrate(database,1);
    await database.query('INSERT INTO goa_core_profiles (id,display_name,email) VALUES ($1,$2,$3)',[ids[0],'Aman','aman@example.invalid']);
    await database.query("INSERT INTO goa_core_trips (id,name,start_date,end_date,created_by) VALUES ($1,'Existing v1 trip','2026-12-04','2026-12-06',$2)",[legacyId,ids[0]]);
    await database.query("INSERT INTO goa_core_memberships (trip_id,user_id,role,status,joined_at) VALUES ($1,$2,'organiser','accepted',now())",[legacyId,ids[0]]);
    await database.query("INSERT INTO goa_core_invitations (id,trip_id,token_hash,expires_at,created_by) VALUES ($1,$2,$3,now()+interval '7 days',$4)",[legacyInviteId,legacyId,hash(legacyToken),ids[0]]);
    await migrate(database);
    await migrate(database);
    app = await buildApp({ config,database,runMigrations: false,logger: false });
    const request = (index: number | null,method: InjectOptions['method'],url: string,payload?: unknown,headers: Record<string,string> = {}) => app!.inject({
      method,url,headers: { ...(payload !== undefined ? { 'content-type': 'application/json' } : {}),...headers,...(index === null ? {} : { authorization: `Bearer ${token(index)}` }) },
      ...(payload !== undefined ? { payload: JSON.stringify(payload) } : {}),
    });
    let trip: Trip;
    let beach: Activity;
    let food: Activity;
    let unscheduled: Activity;
    let paid: Expense;
    let invitationToken: string;
    const tripRetry = randomUUID();

    await t.test('v1 trip, membership and invitation survive repeatable migration with safe defaults',async () => {
      const versions = await database.query<{ version: number }>('SELECT version FROM goa_core_migrations ORDER BY version');
      assert.deepEqual(versions.map((row) => row.version),[1,2,3,4]);
      const response = await request(0,'GET',`/v1/trips/${legacyId}`);
      assert.equal(response.statusCode,200);
      assert.equal(response.json().trip.name,'Existing v1 trip');
      assert.deepEqual({ region: response.json().trip.region,travellerCount: response.json().trip.travellerCount,budgetPaise: response.json().trip.budgetPaise,styles: response.json().trip.styles,acceptedMemberCount: response.json().trip.acceptedMemberCount,activityCount: response.json().trip.activityCount },
        { region: 'all',travellerCount: 1,budgetPaise: null,styles: [],acceptedMemberCount: 1,activityCount: 0 });
      assert.equal(response.json().invitations[0].id,legacyInviteId);
    });

    await t.test('enhanced trip creation and organiser settings preserve backward compatible inputs',async () => {
      const created = await request(0,'POST','/v1/trips',input,{ 'idempotency-key': tripRetry });
      assert.equal(created.statusCode,201,created.body);
      trip = created.json().trip;
      assert.equal(trip.budgetPaise,2_000_000);
      assert.equal(trip.travellerCount,4);
      const invitation = await request(0,'POST',`/v1/trips/${trip.id}/invitations`,{ requiresApproval: false });
      invitationToken = invitation.json().invitation.token;
      assert.equal((await request(1,'POST','/v1/invitations/accept',{ token: invitationToken })).json().status,'accepted');
      assert.equal((await request(0,'GET',`/v1/trips/${trip.id}`)).json().trip.acceptedMemberCount,2);
      assert.equal((await request(1,'PATCH',`/v1/trips/${trip.id}`,{ name: 'Forbidden' })).statusCode,403);
      assert.equal((await request(1,'DELETE',`/v1/trips/${trip.id}`)).statusCode,403);
      const patch = await request(0,'PATCH',`/v1/trips/${trip.id}`,{ description: 'Manually planned; no bookings implied',region: 'all' });
      assert.equal(patch.statusCode,200,patch.body);
      assert.equal(patch.json().trip.description,'Manually planned; no bookings implied');
      for (const changes of [{ travellerCount: 0 },{ travellerCount: 51 },{ budgetPaise: 0.5 },{ budgetPaise: -1 },{ budgetPaise: 1_000_000_001 },{ styles: ['beaches','beaches'] },{ region: 'unknown' },{ role: 'organiser' }]) {
        assert.equal((await request(0,'PATCH',`/v1/trips/${trip.id}`,changes)).statusCode,400);
      }
      assert.equal((await request(0,'POST','/v1/trips',{ name: 'Too long',startDate: '2026-01-01',endDate: '2027-01-03' })).statusCode,400);
      assert.equal((await request(0,'POST','/v1/trips',{ name: '366 days valid',startDate: '2026-01-01',endDate: '2027-01-02' })).statusCode,201);
    });

    await t.test('accepted member creates activities with retry safety and manual unscheduled defaults',async () => {
      const retry = randomUUID();
      const body = { title: 'Beach morning',day: '2026-12-04',category: 'beach',startTime: '09:00',endTime: '10:00',estimatedCostPaise: 800_000,
        description: 'Bring water',notes: 'Keep these trip-specific notes',meetingPoint: 'Main entrance',latitude: 15.5,longitude: 73.7 };
      const repeated = await Promise.all([request(1,'POST',`/v1/trips/${trip.id}/activities`,body,{ 'idempotency-key': retry }),request(1,'POST',`/v1/trips/${trip.id}/activities`,body,{ 'idempotency-key': retry })]);
      assert.deepEqual(repeated.map((response) => response.statusCode),[201,201]);
      beach = repeated[0]!.json().activity;
      assert.equal(repeated[1]!.json().activity.id,beach.id);
      assert.equal(beach.createdBy,ids[1]);
      assert.equal(beach.version,1);
      assert.equal((await request(1,'POST',`/v1/trips/${trip.id}/activities`,{ ...body,title: 'Different' },{ 'idempotency-key': retry })).statusCode,409);
      const foodResponse = await request(0,'POST',`/v1/trips/${trip.id}/activities`,{ title: 'Breakfast',day: '2026-12-04',category: 'cafe',startTime: '09:30',endTime: '11:00' });
      assert.equal(foodResponse.statusCode,201,foodResponse.body);
      food = foodResponse.json().activity;
      unscheduled = (await request(1,'POST',`/v1/trips/${trip.id}/activities`,{ title: 'Maybe later' })).json().activity;
      assert.equal(unscheduled.day,null);
      assert.equal(unscheduled.estimatedCostPaise,0);
      assert.equal(unscheduled.startTime,null);
      assert.equal((await request(0,'GET',`/v1/trips/${trip.id}`)).json().trip.activityCount,3);
      assert.equal((await request(0,'GET',`/v1/trips/${trip.id}/activities`)).json().activities[0].startTime,'09:00');
    });

    await t.test('activity validation rejects untrusted ownership, malformed dates/times and money',async () => {
      for (const changes of [{ createdBy: ids[0] },{ sortOrder: 99 },{ title: '  ' },{ day: '2026-12-07' },{ day: '2026-02-30' },
        { endTime: '12:00' },{ startTime: '10:00',endTime: '09:00' },{ startTime: '25:00' },{ estimatedCostPaise: 0.1 },
        { estimatedCostPaise: -1 },{ estimatedCostPaise: 1_000_000_001 },{ latitude: 100,longitude: 20 },{ latitude: 15 },{ category: 'hotel' }]) {
        const response = await request(1,'POST',`/v1/trips/${trip.id}/activities`,{ title: 'Invalid',...changes });
        assert.equal(response.statusCode,400,response.body);
      }
      assert.equal((await request(1,'PATCH',`/v1/trips/${trip.id}/activities/${beach.id}`,{ title: 'Missing version' })).statusCode,400);
      await assert.rejects(() => database.query('UPDATE goa_core_activities SET estimated_cost_paise=-1 WHERE id=$1',[beach.id]));
      await assert.rejects(() => database.query("UPDATE goa_core_activities SET day='2026-12-30' WHERE id=$1",[beach.id]));
    });

    await t.test('day reorder is exact and atomic, increments versions, and never rewrites time labels',async () => {
      const reordered = await request(1,'POST',`/v1/trips/${trip.id}/activities/reorder`,{ day: '2026-12-04',activityIds: [food.id,beach.id] });
      assert.equal(reordered.statusCode,200,reordered.body);
      assert.deepEqual(reordered.json().activities.map((activity: Activity) => activity.id),[food.id,beach.id]);
      assert.deepEqual(reordered.json().activities.map((activity: Activity) => activity.startTime),['09:30','09:00']);
      food = reordered.json().activities[0];
      beach = reordered.json().activities[1];
      assert.equal(beach.version,2);
      assert.equal((await request(1,'PATCH',`/v1/trips/${trip.id}/activities/${beach.id}`,{ version: 1,title: 'Stale' })).statusCode,409);
      for (const activityIds of [[beach.id],[beach.id,beach.id],[beach.id,randomUUID()]]) {
        assert.equal((await request(1,'POST',`/v1/trips/${trip.id}/activities/reorder`,{ day: '2026-12-04',activityIds })).statusCode,409);
      }
      const unchanged = (await request(0,'GET',`/v1/trips/${trip.id}/activities`)).json().activities;
      assert.deepEqual(unchanged.slice(0,2).map((activity: Activity) => activity.id),[food.id,beach.id]);
      assert.equal(unchanged[0].version,food.version);
      const unscheduledOrder = await request(1,'POST',`/v1/trips/${trip.id}/activities/reorder`,{ day: null,activityIds: [unscheduled.id] });
      assert.equal(unscheduledOrder.statusCode,200,unscheduledOrder.body);
      assert.equal(unscheduledOrder.json().activities[0].day,null);
    });

    await t.test('moving an activity preserves notes and blocks date edits that would orphan it',async () => {
      const moved = await request(1,'PATCH',`/v1/trips/${trip.id}/activities/${beach.id}`,{ version: beach.version,day: '2026-12-06',notes: 'Updated notes stay after restart' });
      assert.equal(moved.statusCode,200,moved.body);
      beach = moved.json().activity;
      assert.equal(beach.description,'Bring water');
      assert.equal(beach.estimatedCostPaise,800_000);
      assert.equal((await request(0,'PATCH',`/v1/trips/${trip.id}`,{ endDate: '2026-12-05' })).statusCode,409);
      const rescheduled = await request(1,'PATCH',`/v1/trips/${trip.id}/activities/${beach.id}`,{ version: beach.version,day: '2026-12-05' });
      beach = rescheduled.json().activity;
      assert.equal((await request(0,'PATCH',`/v1/trips/${trip.id}`,{ endDate: '2026-12-05' })).statusCode,200);
      const foreign = (await request(0,'POST',`/v1/trips/${legacyId}/activities`,{ title: 'Different trip' })).json().activity;
      assert.equal((await request(0,'PATCH',`/v1/trips/${trip.id}/activities/${foreign.id}`,{ version: 1,title: 'Wrong trip' })).statusCode,404);
      assert.equal((await request(0,'DELETE',`/v1/trips/${trip.id}/activities/${foreign.id}`)).statusCode,404);
      assert.equal((await request(0,'POST',`/v1/trips/${trip.id}/activities/reorder`,{ day: null,activityIds: [foreign.id] })).statusCode,409);
      for (let repeat=0;repeat<2;repeat++) assert.equal((await request(1,'DELETE',`/v1/trips/${trip.id}/activities/${food.id}`)).statusCode,204);
      assert.equal((await request(0,'GET',`/v1/trips/${trip.id}`)).json().trip.activityCount,2);
    });

    await t.test('saving a sourced public place is idempotent and does not schedule it',async () => {
      const response = await request(1,'POST',`/v1/trips/${trip.id}/saved-places`,snapshot);
      assert.equal(response.statusCode,200,response.body);
      assert.equal(response.json().place.savedBy,ids[1]);
      const repeated = await request(0,'POST',`/v1/trips/${trip.id}/saved-places`,{ ...snapshot,title: 'Catalogue changed' });
      assert.equal(repeated.json().place.title,snapshot.title);
      assert.equal((await request(0,'GET',`/v1/trips/${trip.id}/saved-places`)).json().places.length,1);
      assert.equal((await request(0,'GET',`/v1/trips/${trip.id}`)).json().trip.activityCount,2);
      for (const changes of [{ sourceUrl: 'javascript:alert(1)' },{ sourceUrl: 'file:///private' },{ sourceUrl: 'https:malformed.example.invalid' },
        { sourceUrl: ' https://example.invalid/' },{ sourceUrl: 'https://synthetic-user:synthetic-password@example.invalid/reference' },
        { sourceUrl: 'https://synthetic-user@example.invalid/reference' },{ savedBy: ids[0] },{ region: 'all' },{ longitude: 181 }]) {
        assert.equal((await request(1,'POST',`/v1/trips/${trip.id}/saved-places`,{ ...snapshot,...changes })).statusCode,400);
      }
      const explicit = await request(1,'POST',`/v1/trips/${trip.id}/activities`,{ title: snapshot.title,category: snapshot.category,day: '2026-12-05',placeId: snapshot.placeId,latitude: snapshot.latitude,longitude: snapshot.longitude,notes: 'Only added by explicit action' });
      assert.equal(explicit.statusCode,201,explicit.body);
      assert.equal(explicit.json().activity.placeId,snapshot.placeId);
      await request(1,'POST',`/v1/trips/${trip.id}/saved-places`,{ ...snapshot,placeId: 'temporary-save' });
      for (let repeat=0;repeat<2;repeat++) assert.equal((await request(1,'DELETE',`/v1/trips/${trip.id}/saved-places/temporary-save`)).statusCode,204);
      assert.equal((await request(0,'GET',`/v1/trips/${trip.id}/saved-places`)).json().places.length,1);
    });

    await t.test('budget separates planned estimates from actual spending and creates paid records once',async () => {
      const retry = randomUUID();
      const body = { title: 'Lunch paid',amountPaise: 125_000,category: 'food',date: '2026-12-05' };
      const responses = await Promise.all([request(1,'POST',`/v1/trips/${trip.id}/expenses`,body,{ 'idempotency-key': retry }),request(1,'POST',`/v1/trips/${trip.id}/expenses`,body,{ 'idempotency-key': retry })]);
      assert.deepEqual(responses.map((response) => response.statusCode),[201,201]);
      paid = responses[0]!.json().expense;
      assert.equal(responses[1]!.json().expense.id,paid.id);
      assert.equal(paid.paidByUserId,ids[1]);
      assert.equal(paid.paidByDisplayName,'Riya');
      assert.equal((await request(1,'POST',`/v1/trips/${trip.id}/expenses`,{ ...body,amountPaise: 125_001 },{ 'idempotency-key': retry })).statusCode,409);
      const budget = (await request(0,'GET',`/v1/trips/${trip.id}/budget`)).json();
      assert.deepEqual({ budgetPaise: budget.budgetPaise,plannedTotalPaise: budget.plannedTotalPaise,actualTotalPaise: budget.actualTotalPaise,remainingPaise: budget.remainingPaise,estimatedPerPersonPaise: budget.estimatedPerPersonPaise,actualPerPersonPaise: budget.actualPerPersonPaise },
        { budgetPaise: 2_000_000,plannedTotalPaise: 800_000,actualTotalPaise: 125_000,remainingPaise: 1_875_000,estimatedPerPersonPaise: 200_000,actualPerPersonPaise: 31_250 });
      assert.equal(budget.expenses.length,1);
      assert.equal(budget.categoryTotals.find((row: { category: string }) => row.category === 'activities').plannedPaise,800_000);
      assert.equal(budget.categoryTotals.find((row: { category: string }) => row.category === 'food').actualPaise,125_000);
      const noBudget = (await request(0,'GET',`/v1/trips/${legacyId}/budget`)).json();
      assert.equal(noBudget.remainingPaise,null);
    });

    await t.test('spending validates exact amounts, dates, payer membership and ownership',async () => {
      const body = { title: 'Invalid paid record',amountPaise: 100,category: 'food',date: '2026-12-05' };
      for (const changes of [{ amountPaise: '1250.00' },{ amountPaise: 0.5 },{ amountPaise: 0 },{ amountPaise: -1 },{ amountPaise: 1_000_000_001 },
        { date: '2026-02-30' },{ paidByUserId: ids[2] },{ createdBy: ids[0] },{ beneficiaries: [ids[1]] },{ title: ' ' }]) {
        const response = await request(1,'POST',`/v1/trips/${trip.id}/expenses`,{ ...body,...changes });
        assert.equal(response.statusCode,400,response.body);
      }
      const extra = (await request(0,'POST',`/v1/trips/${trip.id}/expenses`,{ ...body,title: 'Organiser paid',amountPaise: 101 })).json().expense;
      assert.equal((await request(1,'PATCH',`/v1/trips/${trip.id}/expenses/${extra.id}`,{ version: 1,title: 'Cannot edit another creator' })).statusCode,403);
      assert.equal((await request(1,'DELETE',`/v1/trips/${trip.id}/expenses/${extra.id}`)).statusCode,403);
      assert.equal((await request(0,'DELETE',`/v1/trips/${trip.id}/expenses/${extra.id}`)).statusCode,204);
      const foreign = (await request(0,'POST',`/v1/trips/${legacyId}/expenses`,body)).json().expense;
      assert.equal((await request(0,'PATCH',`/v1/trips/${trip.id}/expenses/${foreign.id}`,{ version: 1,title: 'Wrong trip' })).statusCode,404);
      assert.equal((await request(0,'DELETE',`/v1/trips/${trip.id}/expenses/${foreign.id}`)).statusCode,404);
      await assert.rejects(() => database.query('UPDATE goa_core_expenses SET amount_paise=0 WHERE id=$1',[paid.id]));
    });

    await t.test('organiser/creator corrections preserve versioned spending audit and stale updates conflict',async () => {
      const corrected = await request(0,'PATCH',`/v1/trips/${trip.id}/expenses/${paid.id}`,{ version: paid.version,title: 'Corrected by organiser' });
      assert.equal(corrected.statusCode,200,corrected.body);
      paid = corrected.json().expense;
      assert.equal((await request(1,'PATCH',`/v1/trips/${trip.id}/expenses/${paid.id}`,{ version: 1,title: 'Stale creator form' })).statusCode,409);
      const creator = await request(1,'PATCH',`/v1/trips/${trip.id}/expenses/${paid.id}`,{ version: paid.version,title: 'Creator confirmed',amountPaise: 130_000 });
      assert.equal(creator.statusCode,200,creator.body);
      paid = creator.json().expense;
      const correctedBudget=(await request(0,'GET',`/v1/trips/${trip.id}/budget`)).json();
      assert.equal(correctedBudget.actualTotalPaise,130_000);
      assert.equal(correctedBudget.remainingPaise,1_870_000);
      paid=(await request(1,'PATCH',`/v1/trips/${trip.id}/expenses/${paid.id}`,{ version: paid.version,amountPaise: 125_000 })).json().expense;
      const history = await database.query<{ version: number; amount_paise: number }>('SELECT version,amount_paise FROM goa_core_expense_history WHERE expense_id=$1 ORDER BY version',[paid.id]);
      assert.deepEqual(history.map((row) => row.version),[1,2,3,4]);
      assert.deepEqual(history.map((row) => Number(row.amount_paise)),[125_000,125_000,130_000,125_000]);
      await assert.rejects(() => database.query('DELETE FROM goa_core_expense_history WHERE expense_id=$1',[paid.id]));
      await request(0,'PATCH',`/v1/trips/${trip.id}`,{ travellerCount: 3 });
      assert.equal((await request(0,'GET',`/v1/trips/${trip.id}/budget`)).json().actualPerPersonPaise,41_667);
      await request(0,'PATCH',`/v1/trips/${trip.id}`,{ travellerCount: 4 });
    });

    await t.test('outsider and unauthenticated access fail on every resource family',async () => {
      for (const resource of ['activities','saved-places','budget']) {
        assert.equal((await request(null,'GET',`/v1/trips/${trip.id}/${resource}`)).statusCode,401);
        const actual = await request(2,'GET',`/v1/trips/${trip.id}/${resource}`);
        const unknown = await request(2,'GET',`/v1/trips/${randomUUID()}/${resource}`);
        assert.equal(actual.statusCode,404);
        assert.deepEqual(actual.json(),unknown.json());
      }
      const mutations: [InjectOptions['method'],string,unknown?][] = [
        ['POST','activities',{ title: 'No access' }],['PATCH',`activities/${beach.id}`,{ version: beach.version,title: 'No access' }],
        ['DELETE',`activities/${beach.id}`],['POST','activities/reorder',{ day: null,activityIds: [unscheduled.id] }],
        ['POST','saved-places',snapshot],['DELETE',`saved-places/${snapshot.placeId}`],
        ['POST','expenses',{ title: 'No access',amountPaise: 1,category: 'other',date: '2026-12-05' }],
        ['PATCH',`expenses/${paid.id}`,{ version: paid.version,title: 'No access' }],['DELETE',`expenses/${paid.id}`],
      ];
      for (const [method,path,payload] of mutations) assert.equal((await request(2,method,`/v1/trips/${trip.id}/${path}`,payload)).statusCode,404);
    });

    await t.test('itinerary snapshots, versioned edits and exact budget survive API/database restart',async () => {
      await app!.close(); app=undefined; await database.close();
      database=await openDatabase(config);
      app=await buildApp({ config,database,runMigrations: true,logger: false });
      const activities = (await request(1,'GET',`/v1/trips/${trip.id}/activities`)).json().activities;
      const persisted = activities.find((activity: Activity) => activity.id === beach.id);
      assert.equal(persisted.notes,'Updated notes stay after restart');
      assert.equal(persisted.estimatedCostPaise,800_000);
      assert.equal(persisted.day,'2026-12-05');
      assert.equal(persisted.version,beach.version);
      assert.equal((await request(1,'GET',`/v1/trips/${trip.id}/saved-places`)).json().places[0].title,snapshot.title);
      const budget=(await request(1,'GET',`/v1/trips/${trip.id}/budget`)).json();
      assert.equal(budget.actualTotalPaise,125_000);
      assert.equal(budget.remainingPaise,1_875_000);
      assert.equal(budget.expenses[0].title,'Creator confirmed');
    });

    await t.test('removed member loses every new family while financial provenance remains',async () => {
      assert.equal((await request(0,'DELETE',`/v1/trips/${trip.id}/members/${ids[1]}`)).statusCode,204);
      for (const resource of ['activities','saved-places','budget']) assert.equal((await request(1,'GET',`/v1/trips/${trip.id}/${resource}`)).statusCode,404);
      assert.equal((await request(1,'POST',`/v1/trips/${trip.id}/activities`,{ title: 'Removed' })).statusCode,404);
      assert.equal((await request(1,'POST',`/v1/trips/${trip.id}/saved-places`,snapshot)).statusCode,404);
      assert.equal((await request(1,'POST',`/v1/trips/${trip.id}/expenses`,{ title: 'Removed',amountPaise: 1,category: 'other',date: '2026-12-05' })).statusCode,404);
      assert.equal((await request(1,'PATCH',`/v1/trips/${trip.id}/activities/${beach.id}`,{ version: beach.version,title: 'Removed' })).statusCode,404);
      assert.equal((await request(1,'DELETE',`/v1/trips/${trip.id}/saved-places/${snapshot.placeId}`)).statusCode,404);
      assert.equal((await request(1,'PATCH',`/v1/trips/${trip.id}/expenses/${paid.id}`,{ version: paid.version,title: 'Removed' })).statusCode,404);
      const budget = (await request(0,'GET',`/v1/trips/${trip.id}/budget`)).json();
      assert.equal(budget.actualTotalPaise,125_000);
      assert.equal(budget.expenses[0].paidByDisplayName,'Riya');
      assert.equal((await request(0,'POST',`/v1/trips/${trip.id}/expenses`,{ title: 'Removed payer',amountPaise: 1,category: 'other',date: '2026-12-05',paidByUserId: ids[1] })).statusCode,400);
      const corrected = await request(0,'PATCH',`/v1/trips/${trip.id}/expenses/${paid.id}`,{
        version: paid.version,title: 'Organiser correction after removal',amountPaise: 125_001,paidByUserId: ids[1],
      });
      assert.equal(corrected.statusCode,200,corrected.body);
      paid=corrected.json().expense;
      assert.equal(paid.paidByUserId,ids[1]);
      assert.equal(paid.paidByDisplayName,'Riya');
      assert.equal(paid.createdBy,ids[1]);
      assert.equal((await request(0,'GET',`/v1/trips/${trip.id}/budget`)).json().actualTotalPaise,125_001);
      const currentPayerExpense = (await request(0,'POST',`/v1/trips/${trip.id}/expenses`,{
        title: 'Current payer fixture',amountPaise: 1,category: 'other',date: '2026-12-05',
      })).json().expense;
      assert.equal((await request(0,'PATCH',`/v1/trips/${trip.id}/expenses/${currentPayerExpense.id}`,{
        version: currentPayerExpense.version,paidByUserId: ids[1],
      })).statusCode,400);
      assert.equal((await request(0,'DELETE',`/v1/trips/${trip.id}/expenses/${currentPayerExpense.id}`)).statusCode,204);
      const retained = await database.query<{ actor_id: string; paid_by_user_id: string; amount_paise: number }>(
        'SELECT actor_id,paid_by_user_id,amount_paise FROM goa_core_expense_history WHERE expense_id=$1 ORDER BY version DESC LIMIT 1',[paid.id]);
      assert.equal(retained[0]!.actor_id,ids[0]);
      assert.equal(retained[0]!.paid_by_user_id,ids[1]);
      assert.equal(Number(retained[0]!.amount_paise),125_001);
      assert.equal((await request(1,'PATCH',`/v1/trips/${trip.id}/expenses/${paid.id}`,{
        version: paid.version,title: 'Removed creator remains denied',paidByUserId: ids[1],
      })).statusCode,404);
    });

    await t.test('soft deletion is organiser-only, repeat-safe and hides all resources and invitations',async () => {
      assert.equal((await request(2,'DELETE',`/v1/trips/${trip.id}`)).statusCode,404);
      for (let repeat=0;repeat<2;repeat++) assert.equal((await request(0,'DELETE',`/v1/trips/${trip.id}`)).statusCode,204);
      for (const suffix of ['','/activities','/saved-places','/budget']) assert.equal((await request(0,'GET',`/v1/trips/${trip.id}${suffix}`)).statusCode,404);
      assert.equal((await request(2,'POST','/v1/invitations/accept',{ token: invitationToken })).statusCode,404);
      assert.equal((await request(0,'POST',`/v1/trips/${trip.id}/invitations`,{})).statusCode,404);
      assert.equal((await request(0,'POST',`/v1/trips/${trip.id}/activities`,{ title: 'Deleted trip' })).statusCode,404);
      assert.equal((await request(0,'POST',`/v1/trips/${trip.id}/saved-places`,snapshot)).statusCode,404);
      assert.equal((await request(0,'POST',`/v1/trips/${trip.id}/expenses`,{ title: 'Deleted trip',amountPaise: 1,category: 'other',date: '2026-12-05' })).statusCode,404);
      assert.equal((await request(0,'POST','/v1/trips',input,{ 'idempotency-key': tripRetry })).statusCode,404);
      assert.ok(!(await request(0,'GET','/v1/trips')).json().trips.some((row: Trip) => row.id===trip.id));
      assert.equal((await database.query('SELECT id FROM goa_core_expenses WHERE trip_id=$1',[trip.id])).length,3);
      assert.equal((await database.query("SELECT id FROM goa_core_audit WHERE trip_id=$1 AND action='trip.deleted'",[trip.id])).length,1);
      assert.equal((await request(0,'GET',`/v1/trips/${legacyId}`)).statusCode,200);
    });
  } finally {
    if (app) await app.close();
    await database.close();
    assert.ok(resolve(directory).startsWith(resolve(testRoot)+sep));
    await rm(directory,{ recursive: true,force: true });
  }
});
