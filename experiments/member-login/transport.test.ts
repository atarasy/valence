import { afterEach, expect, test } from 'bun:test';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openMemberAuthority } from '../member-read/authority.ts';
import { openDurableOwnership } from '../member-read/durable-ownership.ts';
import { memberReadBoundary } from '../member-read/gate.ts';
import { openVerifiedLogin } from './login.ts';
import { openEnrollment } from './enrollment.ts';
import { memberTransport } from './transport.ts';
import { syntheticAuthenticator } from './fixtures/authenticator.ts';
import { openStore } from '../../engine/src/common/store.ts';
import { ValenceEngine, canonicalConfig } from '../../engine/src/engine/offers.ts';
import { InMemoryLedger } from '../../engine/src/engine/ledger.ts';
import { createApp } from '../../engine/src/http.ts';
import { ApprovalDesk } from '../../engine/src/hub/approval.ts';
import { RecoveryRegister } from '../../engine/src/hub/node.ts';
import { PermissionLedger } from '../../engine/src/hub/permissions.ts';
import { Registry } from '../../engine/src/shared/registry.ts';
import { DeliveryRegister } from '../../engine/src/hub/delivery.ts';
const cleanups: (() => void)[]=[];
afterEach(()=>{for(const fn of cleanups.splice(0).reverse())fn();});
function setup() {
 const dir=mkdtempSync(join(tmpdir(),'member-transport-'));cleanups.push(()=>rmSync(dir,{recursive:true,force:true}));
 const policy={environment:'test',origin:'https://unit.example',rpID:'unit.example',rpName:'Atarasy test',invitationLifetimeMs:2000,challengeLifetimeMs:1000,sessionLifetimeMs:4000,now:()=>1000};
 const authority=openMemberAuthority(join(dir,'authority.sqlite'),{environment:policy.environment,audience:policy.origin,maxSessionLifetimeMs:5000,now:policy.now});cleanups.push(()=>authority.close());authority.provisionPrincipal('member','own',['presenter']);
 const login=openVerifiedLogin(join(dir,'login.sqlite'),authority,policy);cleanups.push(()=>login.close());
 const enrollment=openEnrollment(join(dir,'enrollment.sqlite'),authority,login,policy);cleanups.push(()=>enrollment.close());
 const store=openStore(join(dir,'engine.sqlite'));cleanups.push(()=>store.close());
 const engine=new ValenceEngine(new InMemoryLedger(),{explorationRate:0.2,reminderLimit:1,recoveryGraceDays:3,relyingPartyId:policy.rpID},store);
 const pair=generateKeyPairSync('ed25519');engine.registerIdentity('presenter',pair.publicKey.export({type:'spki',format:'pem'}).toString(),true);
 const config={version:'cfg',presenter:'presenter',products:{tea:{merchant:'merchant',maker:'maker',ships:'carrier',price:100}}};engine.registerConfig(config,sign(null,canonicalConfig(config),pair.privateKey).toString('base64'));
 const create=(household:string)=>engine.createOffer({binding:'digital',household,purpose:'replenish',config_version:'cfg',expires_at:Date.now()+3600000,mandate:'mandate',price_band:null,giver:null,candidates:[{product:'tea',quantity:1,predicted_conversion:0.5,is_exploration:true,given_by:null}]});
 const own=create('own'),foreign=create('foreign');
 const ownership=openDurableOwnership(join(dir,'engine.sqlite'),authority);cleanups.push(()=>ownership.close());
 const handler=createApp(engine,{deliveries:new DeliveryRegister(),approvals:new ApprovalDesk(),recovery:new RecoveryRegister(),permissions:new PermissionLedger(),registry:new Registry()});
 const state={admitted:true,limiterFailure:false,calls:0,peers:[] as string[]};
 const read=memberReadBoundary({environment:policy.environment,origin:policy.origin,now:policy.now,resolveSession:authority.resolveSession,ownerOf:ownership.ownerOf,next:async request=>{state.calls++;return handler(request);}});
 const transport=memberTransport({authority,login,enrollment,read,maxBodyBytes:8192,admit:async context=>{state.peers.push(context.peer);if(state.limiterFailure)throw new Error('private limiter detail');return state.admitted;}});
 const post=(path:string,payload:unknown,headers:Record<string,string>={})=>transport(new Request(policy.origin+path,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(payload)}),{peer:'trusted-peer'});
 const get=(path:string,token?:string)=>transport(new Request(policy.origin+path,{headers:token?{authorization:'Bearer '+token}:{}}),{peer:'trusted-peer'});
 return {policy,authority,login,enrollment,transport,post,get,own,foreign,state};
}

test('HTTP registration, signed login, durable engine reads, session inspection and logout complete one journey',async()=>{
 const {enrollment,post,get,policy,own,foreign}=setup();const key=syntheticAuthenticator();
 const optionResponse=await post('/auth/enrollment/options',{invitation:enrollment.issueInvitation('member').token});expect(optionResponse.status).toBe(200);const options=await optionResponse.json();
 const registered=await post('/auth/enrollment/verify',{id:options.id,response:key.register(options.publicKey.challenge,policy.origin,policy.rpID)});expect(registered.status).toBe(201);expect(await registered.json()).toEqual({registered:true});
 const challenge=await (await post('/auth/login/options',{})).json();
 const result=await post('/auth/login/verify',{id:challenge.id,response:key.authenticate(challenge.publicKey.challenge,policy.origin,policy.rpID,options.publicKey.user.id)});expect(result.status).toBe(200);expect(result.headers.get('cache-control')).toBe('no-store');const session=await result.json();
 const me=await get('/auth/session',session.token);expect(me.status).toBe(200);expect((await me.json()).household).toBe('own');
 expect((await get('/offers/'+own.id,session.token)).status).toBe(200);
 const list=await get('/offers?household=own&presenter=presenter',session.token);expect(list.status).toBe(200);expect((await list.json()).offers.map((o:{id:string})=>o.id)).toEqual([own.id]);
 expect((await get('/offers/'+foreign.id,session.token)).status).toBe(404);
 expect((await post('/auth/logout',{}, {authorization:'Bearer '+session.token})).status).toBe(204);
 expect((await get('/auth/session',session.token)).status).toBe(401);expect((await get('/offers/'+own.id,session.token)).status).toBe(401);
 expect((await post('/auth/logout',{}, {authorization:'Bearer '+session.token})).status).toBe(204);
});

test('public routes cannot name a principal, register authority directly or grant a household',async()=>{
 const {post,get,enrollment,policy}=setup();const invitation=enrollment.issueInvitation('member');
 expect((await post('/auth/enrollment/options',{invitation:invitation.token,household:'foreign'})).status).toBe(400);
 expect((await post('/auth/login/options',{principal:'foreign'})).status).toBe(400);
 expect((await post('/auth/provision',{principal:'foreign'})).status).toBe(404);
 expect((await post('/auth/login/verify',{id:'00000000-0000-0000-0000-000000000000',response:{},household:'foreign'})).status).toBe(400);
 expect((await get('/auth/enrollment/options')).status).toBe(404);
 expect((await post('/auth/login/options?household=foreign',{})).status).toBe(404);
 // A transport shape rejection does not consume the invitation.
 const flow=await (await post('/auth/enrollment/options',{invitation:invitation.token})).json();expect(flow.publicKey.rp.id).toBe(policy.rpID);
});

test('browser cross-origin, cookies and wrong request origins are refused; native JSON is permitted',async()=>{
 const {post,transport,policy}=setup();
 const rejectedHeaders:Record<string,string>[]=[{origin:'https://foreign.example'},{origin:'null'},{cookie:'session=ambient'},{'sec-fetch-site':'cross-site'},{'sec-fetch-site':'same-site'}];
 for(const headers of rejectedHeaders)expect((await post('/auth/login/options',{},headers)).status).toBe(403);
 expect((await post('/auth/login/options',{}, {origin:policy.origin})).status).toBe(200);
 expect((await post('/auth/login/options',{})).status).toBe(200);
 expect((await transport(new Request('https://foreign.example/auth/login/options',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),{peer:'trusted-peer'})).status).toBe(403);
 expect((await transport(new Request(policy.origin+'/auth/login/options',{method:'OPTIONS'}),{peer:'trusted-peer'})).status).toBe(404);
});

test('malformed, extra, oversized and streamed bodies fail before opening login ceremonies',async()=>{
 const {transport,policy}=setup();
 for(const [content,type] of [['{}','text/plain'],['null','application/json'],['[]','application/json'],['{','application/json'],['{"extra":1}','application/json'],[' '.repeat(8193),'application/json']]){
  const response=await transport(new Request(policy.origin+'/auth/login/options',{method:'POST',headers:{'content-type':type!},body:content}),{peer:'trusted-peer'});expect(response.status).toBe(400);expect(response.headers.get('cache-control')).toBe('no-store');
 }
 let cancelled=false;
 const stream=new ReadableStream<Uint8Array>({pull(controller){controller.enqueue(new Uint8Array(4097));},cancel(){cancelled=true;}});
 expect((await transport(new Request(policy.origin+'/auth/login/options',{method:'POST',headers:{'content-type':'application/json'},body:stream}),{peer:'trusted-peer'})).status).toBe(400);expect(cancelled).toBe(true);
});

test('host admission is required and ignores caller-supplied forwarding identities',async()=>{
 const {post,transport,policy,state,own}=setup();state.admitted=false;
 expect((await post('/auth/login/options',{}, {'x-forwarded-for':'forged'})).status).toBe(429);expect(state.peers).toEqual(['trusted-peer']);
 expect((await transport(new Request(policy.origin+'/offers/'+own.id),{peer:'trusted-peer'})).status).toBe(429);expect(state.calls).toBe(0);
 state.limiterFailure=true;const failed=await post('/auth/login/options',{});expect(failed.status).toBe(503);expect(await failed.text()).not.toContain('private');
 expect((await transport(new Request(policy.origin+'/auth/session'),{peer:''})).status).toBe(503);
});

test('unknown invitations and assertions are neutral and no session can be self-issued',async()=>{
 const {post,get}=setup();
 const first=await post('/auth/enrollment/options',{invitation:'unknown'}),second=await post('/auth/login/verify',{id:'00000000-0000-0000-0000-000000000000',response:{}});
 expect(first.status).toBe(401);expect(second.status).toBe(401);expect(await first.text()).toBe(await second.text());
 expect((await get('/auth/session')).status).toBe(401);expect((await post('/auth/logout',{})).status).toBe(401);
});
