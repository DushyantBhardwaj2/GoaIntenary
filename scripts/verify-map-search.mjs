import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const target=new URL(process.env.GOA_WEB_URL||'http://127.0.0.1:3000');
if(target.protocol!=='http:'||!['127.0.0.1','localhost'].includes(target.hostname))throw new Error('Only synthetic loopback environments are allowed.');
const origin=target.origin;let groups=0;
const pass=name=>{groups++;console.log(`PASS ${name}`);};
async function call(path,method='GET',body,cookie,extra={}){
 const response=await fetch(new URL(path,origin),{method,redirect:'manual',signal:AbortSignal.timeout(20000),headers:{...(method==='GET'?{}:{Origin:origin}),...(body===undefined?{}:{'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
 return{status:response.status,data:response.status===204?null:await response.json(),response};
}
assert.equal((await call('/api/auth/status')).data.localAvailable,true,'Run npm run dev:local first.');
async function login(account){const result=await call('/api/auth/local','POST',{account});assert.equal(result.status,200);const cookie=result.response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');const me=await call('/api/core/v1/me','GET',undefined,cookie);return{cookie,id:me.data.user.id};}
const [owner,member,outsider]=await Promise.all(['aman','riya','dev'].map(login));
const created=await call('/api/core/v1/trips','POST',{name:'Synthetic map-search journey',startDate:'2026-12-04',endDate:'2026-12-06'},owner.cookie,{'Idempotency-Key':randomUUID()});assert.equal(created.status,201);
const base=`/api/core/v1/trips/${created.data.trip.id}`;
try{
 const search=await call('/api/discovery/search?q=Palom%20Beach');assert.equal(search.status,200);assert.equal(search.data.providerAvailable,true,'Wider provider is not available for this live-provider check.');
 const beach=search.data.places.find(place=>place.id==='palolem-beach');assert.ok(beach);assert.equal(beach.title,'Palolem Beach');assert.equal(beach.origin,'reviewed');assert.ok(search.data.places.length>1);
 assert.equal((await call(`${base}/activities`,'GET',undefined,owner.cookie)).data.activities.length,0);
 pass('Palom Beach resolves to Palolem with selectable sourced matches and creates no itinerary automatically');

 const wider=await call('/api/discovery/search?q=Panaji');assert.equal(wider.status,200);assert.equal(wider.data.providerAvailable,true);
 const mapped=wider.data.places.find(place=>place.origin==='openstreetmap');assert.ok(mapped);assert.match(mapped.sourceUrl,/^https:\/\/www\.openstreetmap\.org\/(node|way|relation)\/\d+$/);assert.ok(Number.isFinite(mapped.latitude)&&Number.isFinite(mapped.longitude));
 for(const place of wider.data.places){assert.ok(place.latitude>=14.8&&place.latitude<=15.9);assert.ok(place.longitude>=73.6&&place.longitude<=74.4);assert.equal('rating' in place,false);assert.equal('openingHours' in place,false);}
 pass('Real Photon/OpenStreetMap Goa results extend the reviewed catalogue without invented business details');

 for(const query of ['?q=ab','?q=Goa&q=Palolem','?q=Goa&url=https://example.invalid','?q=Goa&region=west'])assert.equal((await call(`/api/discovery/search${query}`)).status,400);
 assert.equal((await call('/api/discovery/search/private?q=Goa')).status,404);
 const invite=(await call(`${base}/invitations`,'POST',{requiresApproval:false},owner.cookie)).data.invitation.token;await call('/api/core/v1/invitations/accept','POST',{token:invite},member.cookie);
 pass('Public search rejects unsupported inputs and private planning still requires accepted membership');

 const activities=[];
 for(const [index,place] of [beach,mapped].entries()){
  const payload={title:place.title,location:place.area,category:place.category,placeId:place.id,latitude:place.latitude,longitude:place.longitude,notes:`Place source: ${place.sourceUrl}`,day:'2026-12-05',startTime:index?'11:00':'09:00',estimatedCostPaise:0};
  const key=randomUUID(),saved=await call(`${base}/activities`,'POST',payload,member.cookie,{'Idempotency-Key':key});assert.equal(saved.status,201);assert.equal((await call(`${base}/activities`,'POST',payload,member.cookie,{'Idempotency-Key':key})).data.activity.id,saved.data.activity.id);activities.push(saved.data.activity);
 }
 assert.equal((await call(`${base}/saved-places`,'GET',undefined,owner.cookie)).data.places.length,0);
 pass('Explicit selected-place additions use the chosen day and save once, without silently changing saved places');

 const reopened=await call(`${base}/activities`,'GET',undefined,owner.cookie);assert.equal(reopened.status,200);assert.equal(reopened.data.activities.length,2);
 for(const activity of activities){const stored=reopened.data.activities.find(item=>item.id===activity.id);assert.equal(stored.day,'2026-12-05');assert.equal(stored.latitude,activity.latitude);assert.equal(stored.longitude,activity.longitude);assert.equal(stored.notes,activity.notes);assert.equal(stored.placeId,activity.placeId);}
 const snapshot={placeId:mapped.id,title:mapped.title,category:mapped.category,region:mapped.region,latitude:mapped.latitude,longitude:mapped.longitude,sourceUrl:mapped.sourceUrl};assert.equal((await call(`${base}/saved-places`,'POST',snapshot,owner.cookie)).status,200);
 assert.equal((await call(`${base}/activities`,'GET',undefined,owner.cookie)).data.activities.length,2);
 pass('Reopened activities retain pin coordinates/source notes; Save for later remains a separate action');

 assert.equal((await call(`${base}/activities`,'GET',undefined,outsider.cookie)).status,404);assert.equal((await call(`${base}/activities`,'POST',{title:'No access'},outsider.cookie)).status,404);
 await call(`${base}/members/${member.id}`,'DELETE',undefined,owner.cookie);assert.equal((await call(`${base}/activities`,'POST',{title:'Removed'},member.cookie)).status,404);
 pass('Outsiders and removed members cannot turn public search results into private itinerary writes');
 console.log(`${groups} map-search integration groups passed. Actual rendered map focus and keyboard/mobile behavior remain outside this HTTP test.`);
}finally{await call(base,'DELETE',undefined,owner.cookie);}
