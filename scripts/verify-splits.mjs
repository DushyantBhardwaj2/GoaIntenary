import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const target=new URL(process.env.GOA_WEB_URL||'http://127.0.0.1:3000');
if(target.protocol!=='http:'||!['127.0.0.1','localhost'].includes(target.hostname))throw new Error('Only synthetic loopback environments are allowed.');
const origin=target.origin;let groups=0;
const pass=name=>{groups++;console.log(`PASS ${name}`);};
async function call(path,method='GET',body,cookie,headers={}) {
  const response=await fetch(new URL(path,origin),{method,redirect:'manual',signal:AbortSignal.timeout(30000),headers:{...(method==='GET'?{}:{Origin:origin}),...(body===undefined?{}:{'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return{status:response.status,data:response.status===204?null:await response.json(),response};
}
assert.equal((await call('/api/auth/status')).data.localAvailable,true,'Run npm run dev:local first.');
async function login(account){const result=await call('/api/auth/local','POST',{account});assert.equal(result.status,200);const cookie=result.response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');const me=await call('/api/core/v1/me','GET',undefined,cookie);return{cookie,user:me.data.user};}
const [owner,member,outsider]=await Promise.all(['aman','riya','dev'].map(login));
const created=await call('/api/core/v1/trips','POST',{name:'Synthetic selected-splits verification',startDate:'2026-12-04',endDate:'2026-12-06',travellerCount:8,budgetPaise:2000000},owner.cookie,{'Idempotency-Key':randomUUID()});assert.equal(created.status,201);
const base=`/api/core/v1/trips/${created.data.trip.id}`;
try{
  const invite=await call(`${base}/invitations`,'POST',{requiresApproval:false},owner.cookie);await call('/api/core/v1/invitations/accept','POST',{token:invite.data.invitation.token},member.cookie);
  const guests=[];
  for(const displayName of ['Split guest one','Split guest two','Excluded guest']){const result=await call(`${base}/expense-participants`,'POST',{displayName},owner.cookie,{'Idempotency-Key':randomUUID()});assert.equal(result.status,201);guests.push(result.data.participant);}
  assert.equal((await call(base,'GET',undefined,owner.cookie)).data.members.length,2);
  pass('Named guests persist without becoming authenticated trip members');

  const body={title:'Dinner shared by four',amountPaise:400000,category:'food',date:'2026-12-04',paidByParticipantId:owner.user.id,split:{mode:'equal',participantIds:[owner.user.id,member.user.id,guests[0].id,guests[1].id]}};
  const key=randomUUID(),result=await call(`${base}/expenses`,'POST',body,owner.cookie,{'Idempotency-Key':key});assert.equal(result.status,201);let expense=result.data.expense;
  assert.deepEqual(expense.shares.map(share=>share.amountPaise),[100000,100000,100000,100000]);assert.equal((await call(`${base}/expenses`,'POST',body,owner.cookie,{'Idempotency-Key':key})).data.expense.id,expense.id);
  let ledger=(await call(`${base}/ledger`,'GET',undefined,owner.cookie)).data;
  assert.equal(ledger.balances.find(person=>person.participantId===guests[2].id).balancePaise,0);assert.equal(ledger.balances.find(person=>person.participantId===owner.user.id).balancePaise,300000);assert.equal(ledger.balances.reduce((sum,person)=>sum+person.balancePaise,0),0);
  pass('A INR 4000 bill splits exactly among four selected people and excludes the rest');

  const custom={...body,title:'Guest-paid custom split',amountPaise:101,paidByParticipantId:guests[2].id,split:{mode:'custom',shares:[{participantId:owner.user.id,amountPaise:100},{participantId:member.user.id,amountPaise:1}]}};
  assert.equal((await call(`${base}/expenses`,'POST',{...custom,amountPaise:100},member.cookie)).status,400);
  const extra=await call(`${base}/expenses`,'POST',custom,member.cookie);assert.equal(extra.status,201);assert.equal(extra.data.expense.paidByUserId,null);assert.equal(extra.data.expense.shares.length,2);await call(`${base}/expenses/${extra.data.expense.id}`,'DELETE',undefined,member.cookie);
  pass('Custom amounts validate exact totals and a guest payer can be outside the sharing group');

  const catalogue=await call('/api/discovery/places?region=north'),place=catalogue.data.places[0];assert.equal(catalogue.status,200);
  const activity=await call(`${base}/activities`,'POST',{title:place.title,day:'2026-12-04',category:place.category,placeId:place.id,latitude:place.latitude,longitude:place.longitude,estimatedCostPaise:800000},owner.cookie);assert.equal(activity.status,201);
  assert.equal((await call(`${base}/activities`,'GET',undefined,member.cookie)).data.activities[0].latitude,place.latitude);
  const moved=await call(`${base}/activities/${activity.data.activity.id}`,'PATCH',{version:1,day:'2026-12-05'},member.cookie);assert.equal(moved.status,200);assert.equal(moved.data.activity.day,'2026-12-05');assert.equal(moved.data.activity.longitude,place.longitude);
  pass('Filtered discovery coordinates persist with manually moved itinerary stops for map pins');

  const repayment={fromParticipantId:member.user.id,toParticipantId:owner.user.id,amountPaise:25000,date:'2026-12-05',note:'Synthetic partial repayment'},repayKey=randomUUID();
  const paid=await call(`${base}/repayments`,'POST',repayment,member.cookie,{'Idempotency-Key':repayKey});assert.equal(paid.status,201);assert.equal((await call(`${base}/repayments`,'POST',repayment,member.cookie,{'Idempotency-Key':repayKey})).data.repayment.id,paid.data.repayment.id);
  ledger=(await call(`${base}/ledger`,'GET',undefined,owner.cookie)).data;assert.equal(ledger.balances.find(person=>person.participantId===member.user.id).balancePaise,-75000);
  const budget=(await call(`${base}/budget`,'GET',undefined,owner.cookie)).data;assert.equal(budget.actualTotalPaise,400000);assert.equal(budget.plannedTotalPaise,800000);assert.equal(budget.remainingPaise,1600000);
  pass('Partial repayments reduce debt without increasing spending or double-counting estimates');

  assert.equal((await call(`${base}/expenses/${expense.id}`,'PATCH',{version:expense.version,title:'Unconfirmed correction'},owner.cookie)).status,409);
  const corrected=await call(`${base}/expenses/${expense.id}`,'PATCH',{version:expense.version,title:'Confirmed correction',acknowledgeSettlementChange:true},owner.cookie);assert.equal(corrected.status,200);expense=corrected.data.expense;
  assert.equal((await call(`${base}/ledger`,'GET',undefined,owner.cookie)).data.repayments.length,1);
  pass('Corrections after repayments require organiser acknowledgement and preserve repayments');

  for(const path of ['ledger','expense-participants','budget']){const existing=await call(`${base}/${path}`,'GET',undefined,outsider.cookie),unknown=await call(`/api/core/v1/trips/${randomUUID()}/${path}`,'GET',undefined,outsider.cookie);assert.equal(existing.status,404);assert.deepEqual(existing.data,unknown.data);}
  await call(`${base}/members/${member.user.id}`,'DELETE',undefined,owner.cookie);await call(`${base}/expense-participants/${guests[0].id}`,'DELETE',undefined,owner.cookie);
  assert.equal((await call(`${base}/ledger`,'GET',undefined,member.cookie)).status,404);ledger=(await call(`${base}/ledger`,'GET',undefined,owner.cookie)).data;assert.equal(ledger.balances.find(person=>person.participantId===member.user.id).balancePaise,-75000);assert.equal(ledger.participants.find(person=>person.id===guests[0].id).active,false);
  assert.equal((await call(`${base}/expenses`,'POST',{...body,split:{mode:'equal',participantIds:[guests[0].id]}},owner.cookie)).status,400);
  pass('Removed and excluded accounts cannot read the ledger; archived guests retain history');

  await call(`${base}/repayments/${paid.data.repayment.id}`,'DELETE',undefined,owner.cookie);
  assert.equal((await call(`${base}/ledger`,'GET',undefined,owner.cookie)).data.repayments.length,0);assert.equal((await call(`${base}/budget`,'GET',undefined,owner.cookie)).data.actualTotalPaise,400000);
  await call(base,'DELETE',undefined,owner.cookie);assert.equal((await call(`${base}/ledger`,'GET',undefined,owner.cookie)).status,404);
  pass('Repayment corrections and trip deletion preserve boundaries without clearing other trips');
  console.log(`${groups} live map-data/split integration groups passed. Rendered map tiles/mobile remain outside this HTTP test.`);
}finally{await call(base,'DELETE',undefined,owner.cookie);}
