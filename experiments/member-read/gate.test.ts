import { FIXTURE_MANDATE } from '../member-transactions/atomic-fixture.ts';
import { describe, expect, test } from 'bun:test';
import { sign } from 'node:crypto';
import { memberReadBoundary, type Session, type Ownership } from './gate.ts';
import { validProjection } from './projection.ts';
import fixtures from './reference-fixtures.json';
import { CONFIG_VERSION, HOUR, HOUSEHOLD, MANDATE, MERCHANT_PAIR, decideSigned, houseFor, makeEngine } from '../../engine/test/helpers.ts';
import { canonicalCorrection } from '../../engine/src/shared/correction.ts';
import { createApp } from '../../engine/src/http.ts';
import { ApprovalDesk } from '../../engine/src/hub/approval.ts';
import { RecoveryRegister } from '../../engine/src/hub/node.ts';
import { PermissionLedger } from '../../engine/src/hub/permissions.ts';
import { Registry } from '../../engine/src/shared/registry.ts';
const offer=fixtures['digital-offer'];
const offerPath='/offers/'+offer.id;
const base:Session={id:'session-a',environment:'fixture',household:offer.household,presenters:[offer.presenter],expiresAt:2000,revoked:false};
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
function setup(){
 const state:{session:Session|undefined;owner:Ownership|undefined;calls:number;lookups:number;body:any;at:number;onOwner?:()=>void;onNext?:()=>void;lookupError?:boolean;resolverError?:boolean;last?:Request}={session:{...base,presenters:[...base.presenters]},owner:{household:offer.household,presenter:offer.presenter},calls:0,lookups:0,body:offer,at:1000};
 const gate=memberReadBoundary({environment:'fixture',origin:'https://unit.example',now:()=>state.at,
 resolveSession:async token=>{if(state.resolverError)throw new Error('private resolver detail');return token==='fixture-token'?state.session:undefined;},
 ownerOf:async()=>{state.lookups++;state.onOwner?.();if(state.lookupError)throw new Error('private index detail');return state.owner;},
 next:async request=>{state.calls++;state.last=request;state.onNext?.();return response(state.body);}});
 const read=(path=offerPath,method='GET',token='fixture-token',origin='https://unit.example')=>gate(new Request(origin+path,{method,headers:{authorization:'Bearer '+token,'x-household':'forged','x-environment':'forged'}}));
 return {state,read};
}
describe('member read boundary',()=>{
 test('own resource succeeds with no-store and no forwarded credentials/identity headers',async()=>{
  const {state,read}=setup();const result=await read();expect(result.status).toBe(200);expect(await result.json()).toEqual(offer);expect(result.headers.get('cache-control')).toBe('no-store');expect(state.calls).toBe(1);expect(state.last!.headers.get('authorization')).toBeNull();expect(state.last!.headers.get('x-household')).toBeNull();
 });
 test('missing, unknown, expired, revoked and wrong-environment sessions never reach engine',async()=>{
  for(const mutation of ['missing','unknown','expired','revoked','environment']){
   const {state,read}=setup();if(mutation==='missing')state.session=undefined;if(mutation==='expired')state.session!.expiresAt=1000;if(mutation==='revoked')state.session!.revoked=true;if(mutation==='environment')state.session!.environment='elsewhere';
   expect((await read(offerPath,'GET',mutation==='unknown'?'unknown':'fixture-token')).status).toBe(401);expect(state.calls).toBe(0);expect(state.lookups).toBe(0);
  }
 });
 test('foreign and missing resources have identical denial without forwarding',async()=>{
  const results=[];
  for(const owner of [undefined,{household:'other',presenter:offer.presenter},{household:offer.household,presenter:'other'}]){
   const {state,read}=setup();state.owner=owner;const r=await read();results.push([r.status,await r.text()]);expect(state.calls).toBe(0);
  }
  expect(results[0]).toEqual(results[1]);expect(results[1]).toEqual(results[2]);expect(results[0]![0]).toBe(404);
 });
 test('list cannot substitute household/presenter or duplicate/extend query parameters',async()=>{
  const {state,read}=setup();state.body={offers:[offer]};
  const good='/offers?household='+offer.household+'&presenter='+offer.presenter;
  expect((await read(good)).status).toBe(200);
  for(const path of ['/offers','/offers?household=other&presenter='+offer.presenter,'/offers?household='+offer.household+'&presenter=other',good+'&household=other',good+'&rank=1']){const before=state.calls;expect((await read(path)).status).toBe(404);expect(state.calls).toBe(before);}
 });
 test('writes bootstrap extra paths encoded separators and wrong origin are denied',async()=>{
  const {state,read}=setup();
  for(const [path,method] of [[offerPath,'POST'],[offerPath,'HEAD'],['/_identities','POST'],['/_presenter/configs','POST'],['/_disclosures','POST'],[offerPath+'/delivery','GET'],[offerPath+'/settle','POST'],[offerPath+'/extra','GET'],[offerPath+'/','GET'],['/offers/a%2Fb','GET'],[offerPath+'?household=other','GET']])expect((await read(path,method)).status).toBe(404);
  expect((await read(offerPath,'GET','fixture-token','https://other.example')).status).toBe(404);expect(state.calls).toBe(0);
 });
 test('session revocation and grant/account changes while ownership awaits stop forwarding',async()=>{
  for(const change of ['revoked','household','grant','session','expiry']){
   const {state,read}=setup();state.onOwner=()=>{if(change==='revoked')state.session!.revoked=true;if(change==='household')state.session!.household='other';if(change==='grant')state.session!.presenters=[];if(change==='session')state.session!.id='new-session';if(change==='expiry')state.at=2000;};
   expect((await read()).status).toBe(404);expect(state.calls).toBe(0);
  }
 });
 test('revocation during awaited upstream read discards private response',async()=>{
  const {state,read}=setup();state.onNext=()=>{state.session!.revoked=true;};const r=await read();expect(r.status).toBe(404);expect(await r.text()).not.toContain(offer.id);expect(state.calls).toBe(1);
 });
 test('ownership change before dispatch and after upstream completion is refused',async()=>{
  for(const late of [false,true]){
   const {state,read}=setup();if(late)state.onNext=()=>{state.owner!.household='other';};else state.onOwner=()=>{if(state.lookups===2)state.owner!.household='other';};
   expect((await read()).status).toBe(404);expect(state.calls).toBe(late?1:0);
  }
 });
 test('dependency failures are neutral and fail closed',async()=>{
  for(const key of ['lookupError','resolverError'] as const){const {state,read}=setup();state[key]=true;const r=await read();expect(r.status).toBe(503);expect(await r.text()).not.toContain('private');expect(state.calls).toBe(0);}
 });
 test('substituted response and injected private fields are not returned',async()=>{
  for(const changed of [{...offer,household:'other'},{...offer,id:'other'},{...offer,delivery_code:'private'},{...offer,candidates:[{...offer.candidates[0],private_note:'private'}]}]){const {state,read}=setup();state.body=changed;expect((await read()).status).toBe(503);}
 });
 test('every allow-listed projection is checked against fixed schema and resource binding',async()=>{
  for(const [id,path,kind,owner] of [
   ['digital-approval',offerPath+'/approval','approval',{household:offer.household,presenter:offer.presenter}],
   ['physical-statement','/offers/'+fixtures['physical-statement'].offer+'/statement','statement',{household:fixtures['physical-statement'].household,presenter:offer.presenter}],
   ['physical-settled','/offers/'+fixtures['physical-settled'].offer+'/settlement','settlement',{household:base.household,presenter:offer.presenter}],
   ['corrections','/offers/'+fixtures['corrections'].offer+'/corrections','corrections',{household:base.household,presenter:offer.presenter}],
   ['mandate-created','/_node/mandates/'+fixtures['mandate-created'].id,'mandate',{household:fixtures['mandate-created'].household}],
  ] as const){const {state,read}=setup();state.owner=owner;state.session!.household=owner.household;state.body=fixtures[id];expect(validProjection(kind,state.body)).toBe(true);expect((await read(path)).status).toBe(200);}
 });
 test('the mandate route reads the engine\'s own form, so a name no key has is not a mandate',async()=>{
  // §13.2, question 55. A restated copy of the form accepted `key:` and 42
  // `A`s and a `B`, which is not the encoding of any 32 bytes, so two such
  // names could stand for one household and neither is a name any key has.
  // A refutation pass on 2026-09-16 found the copy here and nothing catching it.
  const id=fixtures['mandate-created'].id, owner={household:fixtures['mandate-created'].household};
  // 42 `A`s and a `B`: `B` is not one of the sixteen characters a 32-byte
  // digest can end in, so this decodes and does not encode back to itself.
  const notAKey='key:'+'A'.repeat(42)+'B'+'.1';
  for(const [path,expected] of [
   ['/_node/mandates/'+id,200],
   ['/_node/mandates/'+encodeURIComponent(id),200],
   ['/_node/mandates/'+notAKey,404],
   ['/_node/mandates/'+'key:'+'A'.repeat(42)+'.1',404],
   ['/_node/mandates/'+id.replace('.1',''),404],
  ] as const){
   const {state,read}=setup();state.owner=owner;state.session!.household=owner.household;state.body=fixtures['mandate-created'];
   expect((await read(path)).status).toBe(expected);
  }
 });
 test('malformed auth and upstream failures cannot be interpreted as an authorised read',async()=>{
  let calls=0;const gate=memberReadBoundary({environment:'fixture',origin:'https://unit.example',now:()=>1000,resolveSession:async()=>base,ownerOf:async()=>({household:base.household,presenter:offer.presenter}),next:async()=>{calls++;return new Response('<html>private</html>',{status:500});}});
  for(const auth of [undefined,'Bearer','Bearer a b','Basic fixture-token']){const r=await gate(new Request('https://unit.example'+offerPath,{headers:auth?{authorization:auth}:{}}));expect(r.status).toBe(401);}
  expect(calls).toBe(0);const r=await gate(new Request('https://unit.example'+offerPath,{headers:{authorization:'Bearer fixture-token'}}));expect(r.status).toBe(503);expect(await r.text()).not.toContain('private');
 });
 test('revocation while a promise is suspended discards the completed response',async()=>{
  let release!:()=>void, started!:()=>void;
  const pending=new Promise<void>(resolve=>{release=resolve;});
  const entered=new Promise<void>(resolve=>{started=resolve;});
  const session={...base};
  const gate=memberReadBoundary({environment:'fixture',origin:'https://unit.example',now:()=>1000,resolveSession:async()=>session,ownerOf:async()=>({household:base.household,presenter:offer.presenter}),next:async()=>{started();await pending;return response(offer);}});
  const result=gate(new Request('https://unit.example'+offerPath,{headers:{authorization:'Bearer fixture-token'}}));
  await entered;session.revoked=true;release();
  const denied=await result;expect(denied.status).toBe(404);expect(await denied.text()).not.toContain(offer.id);
 });
 test('protocol read refusals preserve codes but redact diagnostics and missing-resource differences',async()=>{
  for(const status of [400,404,409,422,500]){
   const gate=memberReadBoundary({environment:'fixture',origin:'https://unit.example',now:()=>1000,resolveSession:async()=>base,ownerOf:async()=>({household:base.household,presenter:offer.presenter}),next:async()=>response({error:'future_refusal',message:'private detail'},status)});
   const r=await gate(new Request('https://unit.example'+offerPath,{headers:{authorization:'Bearer fixture-token'}}));const body=await r.json();
   expect(r.status).toBe(status===500?503:status);expect(body.message).not.toContain('private');expect(body.error).toBe([400,409,422].includes(status)?'future_refusal':status===404?'resource_unavailable':'read_unavailable');
  }
 });
 test('real pinned reference handler is reachable only for permitted resources',async()=>{
  const {engine,deliveries}=makeEngine();
  const make=(household:string)=>engine.createOffer({binding:'digital',household,purpose:'replenish',config_version:CONFIG_VERSION,expires_at:Date.now()+3600000,mandate:`${household}.1`,price_band:null,giver:null,candidates:[{product:'tea-a',quantity:1,predicted_conversion:0.5,is_exploration:true,given_by:null}]});
  const own=make(houseFor('fixture-own').household),other=make(houseFor('fixture-other').household);await engine.present(own.id);await engine.present(other.id);
  const index=new Map([own,other].map(o=>[o.id,{household:o.household,presenter:o.presenter}]));
  const expiry=Date.now()+60000;
  const handler=createApp(engine,{deliveries,approvals:new ApprovalDesk(),recovery:new RecoveryRegister(),permissions:new PermissionLedger(),registry:new Registry()});let calls=0;
  const gate=memberReadBoundary({environment:'fixture',origin:'https://unit.example',resolveSession:async t=>t==='fixture-token'?{...base,household:own.household,expiresAt:expiry}:undefined,ownerOf:async r=>index.get(r.id),next:async r=>{calls++;return handler(r);}});
  const get=(path:string)=>gate(new Request('https://unit.example'+path,{headers:{authorization:'Bearer fixture-token'}}));
  // Keep the session expiry stable across revalidation.
  const first=await get('/offers/'+own.id);expect(first.status).toBe(200);expect((await first.json()).household).toBe(own.household);
  expect((await get('/offers/'+other.id)).status).toBe(404);expect(calls).toBe(1);
  const list=await get('/offers?household='+encodeURIComponent(own.household)+'&presenter=merchant-1');expect(list.status).toBe(200);expect((await list.json()).offers.map((o:any)=>o.id)).toEqual([own.id]);
 });
 test('question 70: a household\'s own corrections receipt reads, an unsettled or unowned offer refuses, and a schema mismatch fails closed',async()=>{
  const {engine,deliveries}=makeEngine();
  const offer=engine.createOffer({binding:'digital',household:HOUSEHOLD,purpose:'replenish',config_version:CONFIG_VERSION,expires_at:Date.now()+HOUR,mandate:MANDATE,price_band:null,giver:null,candidates:[{product:'tea-a',quantity:1,predicted_conversion:0.5,is_exploration:true,given_by:null}]});
  await engine.present(offer.id);
  const handler=createApp(engine,{deliveries,approvals:new ApprovalDesk(),recovery:new RecoveryRegister(),permissions:new PermissionLedger(),registry:new Registry()});
  const ownerOf=async(r:{kind:'offer'|'mandate';id:string})=>{try{const o=engine.mustGet(r.id);return {household:o.household,presenter:o.presenter};}catch{return undefined;}};
  const session:Session={id:'session-corrections',environment:'fixture',household:HOUSEHOLD,presenters:['merchant-1'],expiresAt:Date.now()+60000,revoked:false};
  const resolveSession=async(t:string)=>t==='own'?session:t==='other'?{...session,household:'someone-else'}:undefined;
  const gate=memberReadBoundary({environment:'fixture',origin:'https://unit.example',resolveSession,ownerOf,next:handler});
  const path='/offers/'+offer.id+'/corrections';
  const read=(token:string,p=path)=>gate(new Request('https://unit.example'+p,{headers:{authorization:'Bearer '+token}}));
  // Not yet decided, so the offer has no settlement: the upstream 404 passes through.
  expect((await read('own')).status).toBe(404);
  // A foreign household is refused before the engine is ever asked.
  expect((await read('other')).status).toBe(404);
  // An offer id nobody holds answers the same way.
  expect((await read('own','/offers/does-not-exist/corrections')).status).toBe(404);
  await decideSigned(engine,offer.id,offer.candidates.map(c=>({candidate:c.id,valence:'kept' as const,kept_as:'self' as const})));
  await engine.settle(offer.id);
  const settlement=engine.settlement(offer.id)!;
  const fields={id:'r-1',offer:offer.id,merchant:'maker-a',amount:500,kind:'refund' as const,note:'damaged in transit',corrected_at:settlement.settled_at+1};
  const correction={...fields,signature:sign(null,canonicalCorrection(fields),MERCHANT_PAIR.privateKey).toString('base64')};
  engine.appendCorrection(correction,null);
  const own=await read('own');expect(own.status).toBe(200);
  expect(await own.json()).toEqual({offer:offer.id,original:{charged:settlement.charged,carriage:null},corrections:[correction],net:settlement.charged-500});
  expect((await read('other')).status).toBe(404);
  // A response with a field the pinned schema does not name fails closed.
  const corrupting=async(r:Request)=>{const res=await handler(r);const body=await res.json() as Record<string,unknown>;return new Response(JSON.stringify({...body,extra:'unexpected'}),{status:res.status,headers:{'content-type':'application/json'}});};
  const dirty=memberReadBoundary({environment:'fixture',origin:'https://unit.example',resolveSession,ownerOf,next:corrupting});
  const mismatched=await dirty(new Request('https://unit.example'+path,{headers:{authorization:'Bearer own'}}));
  expect(mismatched.status).toBe(503);
 });
});


test('list rows require authoritative ownership and session revalidation after lookups', async () => {
 for (const owner of [undefined, {household:'other',presenter:offer.presenter}, {household:offer.household,presenter:'other'}]) {
  const {state,read}=setup(); state.body={offers:[offer]};state.owner=owner;
  const result=await read('/offers?household='+offer.household+'&presenter='+offer.presenter);
  expect(result.status).toBe(503);expect(await result.text()).not.toContain(offer.id);
 }
 const {state,read}=setup();state.body={offers:[offer]};state.onOwner=()=>{state.session!.revoked=true;};
 expect((await read('/offers?household='+offer.household+'&presenter='+offer.presenter)).status).toBe(404);
});
