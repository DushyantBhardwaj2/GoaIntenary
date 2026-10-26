import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import type {FastifyInstance,InjectOptions} from 'fastify';
import {buildApp} from '../src/app.js';
import {loadConfig} from '../src/config.js';
import {migrate,openDatabase} from '../src/database.js';
import {allocateShares,exactTotal} from '../src/money.js';
import {hash} from '../src/repository.js';
import type {Expense,ExpenseParticipant,Ledger,Repayment} from '../src/types.js';

const secret='ledger-synthetic-test-secret-with-32-bytes';
const ids=['10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003'];
function token(id:string,name='Synthetic traveller') {const body=Buffer.from(JSON.stringify({sub:id,displayName:name,email:`${name.toLowerCase()}@example.invalid`,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');return `local.${body}.${createHmac('sha256',secret).update(`local.${body}`).digest('base64url')}`;}

test('exact subgroup allocation handles deterministic remainder, excluded payer and custom totals',()=>{
  const people=['d','a','c','b'];
  assert.deepEqual(allocateShares(400000,{mode:'equal',participantIds:people}).map(s=>s.amountPaise),[100000,100000,100000,100000]);
  assert.deepEqual(allocateShares(1,{mode:'equal',participantIds:['b','a','c']}),[{participantId:'a',amountPaise:1},{participantId:'b',amountPaise:0},{participantId:'c',amountPaise:0}]);
  assert.deepEqual(allocateShares(101,{mode:'custom',shares:[{participantId:'b',amountPaise:1},{participantId:'a',amountPaise:100}]}),[{participantId:'a',amountPaise:100},{participantId:'b',amountPaise:1}]);
  for(const split of [{mode:'equal',participantIds:[]},{mode:'equal',participantIds:['a','a']},{mode:'custom',shares:[{participantId:'a',amountPaise:100}]},{mode:'custom',shares:[{participantId:'a',amountPaise:0.5},{participantId:'b',amountPaise:100.5}]}] as const) assert.throws(()=>allocateShares(101,split as never),{statusCode:400});
});

test('selected travellers, guests and repayments persist with zero-sum authorised ledger',async t=>{
  const root=fileURLToPath(new URL('../../../.data/tests/',import.meta.url));await mkdir(root,{recursive:true});const directory=await mkdtemp(join(root,'goa-ledger-'));
  const config=loadConfig({NODE_ENV:'test',ENABLE_LOCAL_DEMO:'true',LOCAL_SESSION_SECRET:secret,PGLITE_DATA_DIR:directory});
  let database=await openDatabase(config),app:FastifyInstance|undefined;
  const legacyTrip=randomUUID(),legacyExpense=randomUUID(),legacyRetry=randomUUID();
  try {
    await migrate(database,2);
    await database.query('INSERT INTO goa_core_profiles (id,display_name) VALUES ($1,$2)',[ids[0],'Aman']);
    await database.query("INSERT INTO goa_core_trips (id,name,start_date,end_date,created_by) VALUES ($1,'Saved v2 trip','2026-12-01','2026-12-03',$2)",[legacyTrip,ids[0]]);
    await database.query("INSERT INTO goa_core_memberships (trip_id,user_id,role,status,joined_at) VALUES ($1,$2,'organiser','accepted',now())",[legacyTrip,ids[0]]);
    await database.query("INSERT INTO goa_core_expenses (id,trip_id,title,amount_paise,category,date,paid_by_user_id,created_by) VALUES ($1,$2,'Original unsplit expense',2500,'food','2026-12-01',$3,$3)",[legacyExpense,legacyTrip,ids[0]]);
    await database.query("INSERT INTO goa_core_expense_history (id,expense_id,version,actor_id,operation,title,amount_paise,category,date,paid_by_user_id) VALUES ($1,$2,1,$3,'created','Original unsplit expense',2500,'food','2026-12-01',$3)",[randomUUID(),legacyExpense,ids[0]]);
    await database.query("INSERT INTO goa_core_write_idempotency (actor_id,trip_id,scope,request_key,request_hash,target_id) VALUES ($1,$2,'expense',$3,$4,$5)",[ids[0],legacyTrip,legacyRetry,hash(JSON.stringify({title:'Original unsplit expense',amountPaise:2500,category:'food',date:'2026-12-01',paidByUserId:ids[0]})),legacyExpense]);
    await migrate(database);await migrate(database);
    app=await buildApp({config,database,runMigrations:false,logger:false});
    const req=(index:number|null,method:InjectOptions['method'],url:string,payload?:unknown,headers:Record<string,string>={})=>app!.inject({method,url,headers:{...(index===null?{}:{authorization:`Bearer ${token(ids[index]!,['Aman','Riya','Dev'][index])}`}),...(payload===undefined?{}:{'content-type':'application/json'}),...headers},...(payload===undefined?{}:{payload:JSON.stringify(payload)})});
    const result=await req(0,'POST','/v1/trips',{name:'Subgroup holiday',startDate:'2026-12-01',endDate:'2026-12-03',travellerCount:8,budgetPaise:1000000});assert.equal(result.statusCode,201,result.body);
    const trip=result.json().trip.id,base=`/v1/trips/${trip}`;
    const invite=(await req(0,'POST',`${base}/invitations`,{requiresApproval:false})).json().invitation.token;
    assert.equal((await req(1,'POST','/v1/invitations/accept',{token:invite})).statusCode,200);
    const guest:ExpenseParticipant[]=[];
    let bill:Expense,repayment:Repayment;
    const ledger=async()=>{const r=await req(0,'GET',`${base}/ledger`);assert.equal(r.statusCode,200,r.body);const data=r.json<Ledger>();assert.equal(exactTotal(data.balances.map(b=>b.balancePaise)),0);return data;};
    const body={title:'Dinner for four',amountPaise:400000,category:'food',date:'2026-12-01'};

    await t.test('v2 expenses and immutable history survive migration without inventing beneficiaries',async()=>{
      const budget=(await req(0,'GET',`/v1/trips/${legacyTrip}/budget`)).json();assert.equal(budget.actualTotalPaise,2500);assert.equal(budget.expenses[0].paidByParticipantId,ids[0]);assert.equal(budget.expenses[0].splitMode,'none');assert.deepEqual(budget.expenses[0].shares,[]);
      const old=(await req(0,'GET',`/v1/trips/${legacyTrip}/ledger`)).json();assert.equal(old.unallocatedTotalPaise,2500);assert.equal(old.balances[0].balancePaise,0);
      assert.equal((await database.query<{version:number}>('SELECT version FROM goa_core_expense_history WHERE expense_id=$1',[legacyExpense]))[0]!.version,1);
      const retry=await req(0,'POST',`/v1/trips/${legacyTrip}/expenses`,{title:'Original unsplit expense',amountPaise:2500,category:'food',date:'2026-12-01'},{'idempotency-key':legacyRetry});assert.equal(retry.statusCode,201,retry.body);assert.equal(retry.json().expense.id,legacyExpense);
    });
    await t.test('organiser creates retry-safe distinct guests without account or membership rights',async()=>{
      assert.equal((await req(1,'POST',`${base}/expense-participants`,{displayName:'No permission'})).statusCode,403);
      const key=randomUUID(),payload={displayName:'Kavya'};
      const twice=await Promise.all([req(0,'POST',`${base}/expense-participants`,payload,{'idempotency-key':key}),req(0,'POST',`${base}/expense-participants`,payload,{'idempotency-key':key})]);
      assert.deepEqual(twice.map(r=>r.statusCode),[201,201]);assert.equal(twice[0]!.json().participant.id,twice[1]!.json().participant.id);guest.push(twice[0]!.json().participant);
      for(const displayName of ['Neel','Sam','Jo'])guest.push((await req(0,'POST',`${base}/expense-participants`,{displayName})).json().participant);
      assert.equal((await req(0,'POST',`${base}/expense-participants`,payload)).statusCode,409);
      assert.equal((await req(0,'POST',`${base}/expense-participants`,{displayName:'Someone',userId:ids[2]})).statusCode,400);
      assert.equal((await database.query('SELECT user_id FROM goa_core_memberships WHERE trip_id=$1',[trip])).length,2);
      assert.equal((await app!.inject({method:'GET',url:base,headers:{authorization:`Bearer ${token(guest[0]!.id)}`}})).statusCode,401);
    });
    await t.test('one payer splits four ways in a larger group while excluded travellers owe zero',async()=>{
      const payload={...body,paidByParticipantId:ids[0],split:{mode:'equal',participantIds:[ids[0],ids[1],guest[0]!.id,guest[1]!.id]}};
      const key=randomUUID(),created=await req(0,'POST',`${base}/expenses`,payload,{'idempotency-key':key});assert.equal(created.statusCode,201,created.body);bill=created.json().expense;
      assert.deepEqual(bill.shares.map(s=>s.amountPaise),[100000,100000,100000,100000]);assert.equal(bill.shares.length,4);
      assert.equal((await req(0,'POST',`${base}/expenses`,payload,{'idempotency-key':key})).json().expense.id,bill.id);
      assert.equal((await req(0,'POST',`${base}/expenses`,{...payload,amountPaise:1},{'idempotency-key':key})).statusCode,409);
      const data=await ledger();assert.equal(data.balances.find(b=>b.participantId===ids[0])!.balancePaise,300000);assert.equal(data.balances.find(b=>b.participantId===ids[1])!.balancePaise,-100000);
      for(const person of guest.slice(2))assert.equal(data.balances.find(b=>b.participantId===person.id)!.balancePaise,0);
      assert.equal(data.settlements.length,3);assert.equal((await req(0,'GET',`${base}/budget`)).json().actualTotalPaise,400000);
    });
    await t.test('guest payer may be excluded, custom amounts are exact and stored shares enforce database totals',async()=>{
      const forFour=await req(0,'POST',`${base}/expenses`,{...body,paidByParticipantId:guest[2]!.id,split:{mode:'equal',participantIds:[ids[0],ids[1],guest[0]!.id,guest[1]!.id]}});assert.equal(forFour.statusCode,201,forFour.body);
      assert.deepEqual(forFour.json().expense.shares.map((s:{amountPaise:number})=>s.amountPaise),[100000,100000,100000,100000]);assert.equal((await ledger()).balances.find(b=>b.participantId===guest[2]!.id)!.balancePaise,400000);await req(0,'DELETE',`${base}/expenses/${forFour.json().expense.id}`);
      const created=await req(1,'POST',`${base}/expenses`,{...body,title:'Guest treats two friends',amountPaise:101,paidByParticipantId:guest[2]!.id,split:{mode:'custom',shares:[{participantId:ids[0],amountPaise:100},{participantId:ids[1],amountPaise:1}]}});assert.equal(created.statusCode,201,created.body);
      const expense=created.json< {expense:Expense} >().expense;assert.equal(expense.paidByUserId,null);assert.ok(!expense.shares.some(s=>s.participantId===guest[2]!.id));
      assert.equal((await ledger()).balances.find(b=>b.participantId===guest[2]!.id)!.balancePaise,101);
      await assert.rejects(()=>database.query('UPDATE goa_core_expense_shares SET amount_paise=amount_paise+1 WHERE expense_id=$1',[expense.id]));
      assert.equal(exactTotal((await req(0,'GET',`${base}/budget`)).json().expenses.find((e:Expense)=>e.id===expense.id).shares.map((s:{amountPaise:number})=>s.amountPaise)),101);
      assert.equal((await req(0,'PATCH',`${base}/expenses/${expense.id}`,{version:expense.version,amountPaise:102})).statusCode,400);
      assert.equal((await req(1,'DELETE',`${base}/expenses/${expense.id}`)).statusCode,204);
    });
    await t.test('bad, empty, duplicate, foreign and fractional split inputs roll back without a new expense',async()=>{
      const foreign=(await req(0,'POST',`/v1/trips/${legacyTrip}/expense-participants`,{displayName:'Foreign guest'})).json().participant.id;
      const splits=[{mode:'equal',participantIds:[]},{mode:'equal',participantIds:[ids[0],ids[0]]},{mode:'equal',participantIds:[foreign]},{mode:'custom',shares:[{participantId:ids[0],amountPaise:1}]},{mode:'custom',shares:[{participantId:ids[0],amountPaise:400000},{participantId:ids[0],amountPaise:0}]},{mode:'custom',shares:[{participantId:ids[0],amountPaise:0.5}]}];
      for(const split of splits)assert.equal((await req(0,'POST',`${base}/expenses`,{...body,split})).statusCode,400);
      assert.equal((await req(0,'POST',`${base}/expenses`,{...body,paidByUserId:ids[0],paidByParticipantId:ids[1]})).statusCode,400);
      assert.equal((await req(0,'GET',`${base}/budget`)).json().expenses.length,1);
    });
    await t.test('one paise across three selected people persists exact deterministic shares',async()=>{
      const selected=[ids[0],guest[1]!.id,guest[0]!.id];const created=await req(0,'POST',`${base}/expenses`,{...body,amountPaise:1,split:{mode:'equal',participantIds:selected}});assert.equal(created.statusCode,201,created.body);
      const expense=created.json().expense;assert.deepEqual(expense.shares.map((s:{amountPaise:number})=>s.amountPaise),[1,0,0]);assert.equal(expense.shares[0].participantId,[...selected].sort()[0]);await req(0,'DELETE',`${base}/expenses/${expense.id}`);
    });
    await t.test('partial repayment changes balances, retries once and never changes spending',async()=>{
      const payload={fromParticipantId:ids[1],toParticipantId:ids[0],amountPaise:25000,date:'2026-12-02',note:'Synthetic cash record'},key=randomUUID();
      assert.equal((await req(1,'POST',`${base}/repayments`,{...payload,fromParticipantId:guest[0]!.id})).statusCode,403);
      const created=await req(1,'POST',`${base}/repayments`,payload,{'idempotency-key':key});assert.equal(created.statusCode,201,created.body);repayment=created.json().repayment;
      assert.equal((await req(1,'POST',`${base}/repayments`,payload,{'idempotency-key':key})).json().repayment.id,repayment.id);
      const data=await ledger();assert.equal(data.repayments.length,1);assert.equal(data.balances.find(b=>b.participantId===ids[1])!.balancePaise,-75000);assert.equal(data.balances.find(b=>b.participantId===ids[0])!.balancePaise,275000);
      assert.equal((await req(0,'GET',`${base}/budget`)).json().actualTotalPaise,400000);
      for(const changes of [{amountPaise:75001},{amountPaise:0},{amountPaise:0.5},{fromParticipantId:ids[0]},{toParticipantId:ids[1]},{date:'2026-02-30'}])assert.equal((await req(0,'POST',`${base}/repayments`,{...payload,...changes})).statusCode,400);
    });
    await t.test('repayment-aware corrections require organiser acknowledgement and retain immutable share history',async()=>{
      assert.equal((await req(0,'PATCH',`${base}/expenses/${bill.id}`,{version:bill.version,title:'No confirmation'})).statusCode,409);
      assert.equal((await req(0,'DELETE',`${base}/expenses/${bill.id}`)).statusCode,409);
      const updated=await req(0,'PATCH',`${base}/expenses/${bill.id}`,{version:bill.version,title:'Group-confirmed correction',acknowledgeSettlementChange:true});assert.equal(updated.statusCode,200,updated.body);bill=updated.json().expense;
      assert.equal((await ledger()).repayments.length,1);
      const history=await database.query<{shares:unknown[]}>('SELECT shares FROM goa_core_expense_history WHERE expense_id=$1 ORDER BY version',[bill.id]);assert.equal(history.length,2);assert.equal(history[0]!.shares.length,4);assert.equal(history[1]!.shares.length,4);
      await assert.rejects(()=>database.query('DELETE FROM goa_core_expense_history WHERE expense_id=$1',[bill.id]));
      const own=(await req(1,'POST',`${base}/expenses`,{...body,amountPaise:1})).json().expense;
      assert.equal((await req(1,'PATCH',`${base}/expenses/${own.id}`,{version:1,title:'Member cannot waive',acknowledgeSettlementChange:true})).statusCode,409);
      assert.equal((await req(0,'DELETE',`${base}/expenses/${own.id}?acknowledgeSettlementChange=true`)).statusCode,204);
    });
    await t.test('new members do not inherit shares; removed members and archived guests retain historical balances',async()=>{
      await req(2,'POST','/v1/invitations/accept',{token:invite});assert.equal((await ledger()).balances.find(b=>b.participantId===ids[2])!.balancePaise,0);
      assert.equal((await req(0,'DELETE',`${base}/members/${ids[1]}`)).statusCode,204);assert.equal((await req(0,'DELETE',`${base}/expense-participants/${guest[0]!.id}`)).statusCode,204);
      const data=await ledger();assert.equal(data.participants.find(p=>p.id===guest[0]!.id)!.active,false);assert.equal(data.balances.find(b=>b.participantId===ids[1])!.balancePaise,-75000);
      for(const id of [ids[1],guest[0]!.id]){assert.equal((await req(0,'POST',`${base}/expenses`,{...body,split:{mode:'equal',participantIds:[id]}})).statusCode,400);assert.equal((await req(0,'POST',`${base}/expenses`,{...body,paidByParticipantId:id})).statusCode,400);}
      const updated=await req(0,'PATCH',`${base}/expenses/${bill.id}`,{version:bill.version,title:'Retain historical people',split:{mode:'equal',participantIds:bill.shares.map(s=>s.participantId)},acknowledgeSettlementChange:true});assert.equal(updated.statusCode,200,updated.body);bill=updated.json().expense;
    });
    await t.test('outsider, pending and removed access fail on every ledger read and write',async()=>{
      const outsiderTrip=(await req(0,'POST','/v1/trips',{name:'Private second trip',startDate:'2026-12-01',endDate:'2026-12-03'})).json().trip.id;
      const pending=(await req(0,'POST',`/v1/trips/${outsiderTrip}/invitations`,{requiresApproval:true})).json().invitation.token;await req(2,'POST','/v1/invitations/accept',{token:pending});
      for(const index of [1,2])for(const suffix of ['ledger','expense-participants']){
        const target=index===1?trip:outsiderTrip;const denied=await req(index,'GET',`/v1/trips/${target}/${suffix}`),unknown=await req(index,'GET',`/v1/trips/${randomUUID()}/${suffix}`);assert.equal(denied.statusCode,404);assert.deepEqual(denied.json(),unknown.json());
      }
      assert.equal((await req(null,'GET',`${base}/ledger`)).statusCode,401);
      for(const [method,path,payload] of [['POST','expense-participants',{displayName:'No access'}],['DELETE',`expense-participants/${guest[0]!.id}`,undefined],['POST','repayments',{fromParticipantId:ids[1],toParticipantId:ids[0],amountPaise:1,date:'2026-12-01'}],['DELETE',`repayments/${repayment.id}`,undefined]] as const)assert.equal((await req(1,method,`${base}/${path}`,payload)).statusCode,404);
    });
    await t.test('stored shares, guests, repayment and zero-sum balances survive actual database reopen',async()=>{
      const before=await ledger();await app!.close();app=undefined;await database.close();database=await openDatabase(config);app=await buildApp({config,database,runMigrations:true,logger:false});const after=await ledger();assert.deepEqual(after,before);
      const persisted=(await req(0,'GET',`${base}/budget`)).json().expenses.find((e:Expense)=>e.id===bill.id);assert.equal(persisted.shares.length,4);assert.equal(persisted.version,bill.version);
    });
    await t.test('repayment correction is audited, repeat-safe and soft-deleted trip hides all financial resources',async()=>{
      assert.equal((await req(2,'DELETE',`${base}/repayments/${repayment.id}`)).statusCode,403);
      assert.equal((await req(0,'DELETE',`${base}/repayments/${repayment.id}`)).statusCode,204);assert.equal((await req(0,'DELETE',`${base}/repayments/${repayment.id}`)).statusCode,204);assert.equal((await ledger()).repayments.length,0);
      assert.equal((await req(0,'GET',`${base}/budget`)).json().actualTotalPaise,400000);
      assert.equal((await database.query('SELECT id FROM goa_core_repayments WHERE id=$1 AND deleted_at IS NOT NULL',[repayment.id])).length,1);
      await req(0,'DELETE',base);for(const resource of ['ledger','expense-participants','budget'])assert.equal((await req(0,'GET',`${base}/${resource}`)).statusCode,404);
      assert.equal((await req(0,'POST',`${base}/expense-participants`,{displayName:'Deleted trip guest'})).statusCode,404);
      assert.equal((await req(0,'GET',`/v1/trips/${legacyTrip}/budget`)).json().actualTotalPaise,2500);
    });
  }finally{if(app)await app.close();await database.close();assert.ok(resolve(directory).startsWith(resolve(root)+sep));await rm(directory,{recursive:true,force:true});}
});
