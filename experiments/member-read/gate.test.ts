import { describe, expect, test } from 'bun:test';
import { memberReadBoundary, type Session, type Ownership } from './gate.ts';
import { validProjection } from './projection.ts';
import fixtures from './reference-fixtures.json';
import { makeEngine, CONFIG_VERSION } from '../../engine/test/helpers.ts';
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
   ['mandate-created','/_node/mandates/'+fixtures['mandate-created'].id,'mandate',{household:fixtures['mandate-created'].household}],
  ] as const){const {state,read}=setup();state.owner=owner;state.session!.household=owner.household;state.body=fixtures[id];expect(validProjection(kind,state.body)).toBe(true);expect((await read(path)).status).toBe(200);}
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
  const make=(household:string)=>engine.createOffer({binding:'digital',household,purpose:'replenish',config_version:CONFIG_VERSION,expires_at:Date.now()+3600000,mandate:'mandate-1',price_band:null,giver:null,candidates:[{product:'tea-a',quantity:1,predicted_conversion:0.5,is_exploration:true,given_by:null}]});
  const own=make('fixture-own'),other=make('fixture-other');await engine.present(own.id);await engine.present(other.id);
  const index=new Map([own,other].map(o=>[o.id,{household:o.household,presenter:o.presenter}]));
  const expiry=Date.now()+60000;
  const handler=createApp(engine,{deliveries,approvals:new ApprovalDesk(),recovery:new RecoveryRegister(),permissions:new PermissionLedger(),registry:new Registry()});let calls=0;
  const gate=memberReadBoundary({environment:'fixture',origin:'https://unit.example',resolveSession:async t=>t==='fixture-token'?{...base,household:'fixture-own',expiresAt:expiry}:undefined,ownerOf:async r=>index.get(r.id),next:async r=>{calls++;return handler(r);}});
  const get=(path:string)=>gate(new Request('https://unit.example'+path,{headers:{authorization:'Bearer fixture-token'}}));
  // Keep the session expiry stable across revalidation.
  const first=await get('/offers/'+own.id);expect(first.status).toBe(200);expect((await first.json()).household).toBe('fixture-own');
  expect((await get('/offers/'+other.id)).status).toBe(404);expect(calls).toBe(1);
  const list=await get('/offers?household=fixture-own&presenter=merchant-1');expect(list.status).toBe(200);expect((await list.json()).offers.map((o:any)=>o.id)).toEqual([own.id]);
 });
});
