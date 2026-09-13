import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { seedUnified, unifiedRuntime, loginResponse } from './unified-fixture.ts';
import { atomicScope } from './atomic-fixture.ts';
import { openAtomicStore } from './atomic-store.ts';
import { openDevelopmentMemberHTTP } from './development-member-http.ts';
import { openMemberAuthority } from '../member-read/authority.ts';
import { openVerifiedLogin } from '../member-login/login.ts';
import { openEnrollment } from '../member-login/enrollment.ts';
import { syntheticAuthenticator } from '../member-login/fixtures/authenticator.ts';
import type { MemberRuntimeConfig } from './member-http.ts';
const cleanup:(()=>void)[]=[];afterEach(()=>{for(const f of cleanup.splice(0).reverse())f();});
const config:MemberRuntimeConfig={environment:'test',origin:atomicScope.audience,rpID:'unit.example',explorationRate:0.2,reminderLimit:1,recoveryGraceDays:3,dayBoundary:'UTC',maximumLifetimeMs:60000,maxSessionLifetimeMs:100000,maximumBodyBytes:20000,bodyTimeoutMs:50,maximumPending:8,budgetWindowMs:60000,maximumRequests:100,maximumTrackedTokens:100};
async function setup(overrides:Partial<MemberRuntimeConfig>={}) {
 const dir=mkdtempSync(join(tmpdir(),'development-member-'));cleanup.push(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'db.sqlite'),seeded=await seedUnified(path),unit=openAtomicStore(path,atomicScope);cleanup.push(()=>unit.close());
 await unit.run((store,db)=>unifiedRuntime(store,db).journal.cancel(seeded.input.token,seeded.input.operation.id));
 const policy={...config,...overrides},app=await openDevelopmentMemberHTTP(path,policy);cleanup.push(()=>app.close());
 const req=(route:string,body?:unknown,token?:string)=>new Request(config.origin+route,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const send=(route:string,body?:unknown,token?:string)=>app.fetch(req(route,body,token),{peer:'fixture-peer'});
 const invite=()=>unit.run((_store,db)=>{
  const authority=openMemberAuthority(db,{...atomicScope,maxSessionLifetimeMs:100000});authority.provisionPrincipal('new-member','house',['merchant-1']);
  const p={environment:'test',origin:config.origin,rpID:config.rpID,challengeLifetimeMs:60000,sessionLifetimeMs:100000};const login=openVerifiedLogin(db,authority,p);
  return openEnrollment(db,authority,login,{...p,rpName:'Atarasy',invitationLifetimeMs:60000}).issueInvitation('new-member');
 });
 return {dir,path,...seeded,unit,app,req,send,invite,policy};
}
test('one composition signs in reads prepares submits reconciles and revokes',async()=>{
 const s=await setup(),flow=await (await s.send('/auth/login/options',{})).json();
 const logged=await s.send('/auth/login/verify',{id:flow.id,response:loginResponse(s.pair,s.input.credential,s.user,flow.publicKey.challenge,2)});expect(logged.status).toBe(200);const grant=await logged.json();
 expect((await s.send('/auth/session',undefined,grant.token)).status).toBe(200);
 for(const route of ['/offers?household=house&presenter=merchant-1','/offers/'+s.input.statement.offer,'/offers/'+s.input.statement.offer+'/statement'])expect((await s.send(route,undefined,grant.token)).status).toBe(200);
 const prepared=await s.send('/member/statements/prepare',{offer:s.input.statement.offer,disputed:[]},grant.token);expect(prepared.status).toBe(200);const p=await prepared.json();
 const committed=await s.send('/member/operations/'+p.operationID+'/submit',{assertion:loginResponse(s.pair,s.input.credential,s.user,p.publicKey.challenge,3)},grant.token);expect(committed.status).toBe(200);
 expect(await (await s.send('/member/operations/'+p.operationID+'/outcome',undefined,grant.token)).json()).toEqual(await committed.json());
 expect((await s.send('/auth/logout',{},grant.token)).status).toBe(204);expect((await s.send('/auth/session',undefined,grant.token)).status).toBe(401);
 expect((await s.send('/member/operations/'+p.operationID+'/outcome',undefined,grant.token)).status).toBe(404);
});
test('registration and login share the selected database and consume replay',async()=>{
 const s=await setup(),key=syntheticAuthenticator(),invitation=await s.invite(),flow=await (await s.send('/auth/enrollment/options',{invitation:invitation.token})).json();
 const response=key.register(flow.publicKey.challenge,config.origin,config.rpID);
 expect((await s.send('/auth/enrollment/verify',{id:flow.id,response})).status).toBe(201);
 expect((await s.send('/auth/enrollment/verify',{id:flow.id,response})).status).toBe(401);
 const login=await (await s.send('/auth/login/options',{})).json();const grant=await (await s.send('/auth/login/verify',{id:login.id,response:key.authenticate(login.publicKey.challenge,config.origin,config.rpID,flow.publicKey.user.id)})).json();
 expect((await s.send('/auth/session',undefined,grant.token)).status).toBe(200);
});
test('failed registration activation consumes ceremony and rolls back partial credential',async()=>{
 const s=await setup(),key=syntheticAuthenticator(),invitation=await s.invite(),flow=await (await s.send('/auth/enrollment/options',{invitation:invitation.token})).json();
 const db=new Database(s.path);db.run("CREATE TRIGGER injected_activation BEFORE UPDATE OF active ON passkeys WHEN NEW.active=1 BEGIN SELECT RAISE(ABORT,'injected');END");
 try {
  expect((await s.send('/auth/enrollment/verify',{id:flow.id,response:key.register(flow.publicKey.challenge,config.origin,config.rpID)})).status).toBe(401);
  for(const [table,column,id] of [['flows','id',flow.id],['passkeys','id',key.id],['credentials','id',key.id]])expect(db.query(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column}=?`).get(id) as {n:number}).toEqual({n:0});
 } finally {db.close();}
});
test('cutover preserves live enrolment and fences every auth read and write on source',async()=>{
 const s=await setup(),key=syntheticAuthenticator(),invitation=await s.invite(),flow=await (await s.send('/auth/enrollment/options',{invitation:invitation.token})).json();
 const plan=await s.app.prepareCutover(join(s.dir,'target'));
 expect((await s.send('/auth/login/options',{})).status).toBe(503);expect((await s.send('/auth/session',undefined,s.input.token)).status).toBe(503);
 await s.app.activateCutover(plan.ticket);
 const target=await openDevelopmentMemberHTTP(plan.target,s.policy);cleanup.push(()=>target.close());
 const req=s.req('/auth/enrollment/verify',{id:flow.id,response:key.register(flow.publicKey.challenge,config.origin,config.rpID)});
 expect((await target.fetch(req,{peer:'fixture-peer'})).status).toBe(201);
 expect((await s.send('/auth/login/options',{})).status).toBe(503);
});
test('unknown routes cookies forged peers and foreign household reads cannot bypass the boundary',async()=>{
 const s=await setup();for(const path of ['/identities','/households/house/import','/auth/admin'])expect((await s.send(path,{})).status).toBe(404);
 expect((await s.send('/offers?household=foreign&presenter=merchant-1',undefined,s.input.token)).status).toBe(404);
 const req=s.req('/auth/login/options',{});req.headers.set('x-forwarded-for','allowed-peer');expect((await s.app.fetch(req,{peer:''})).status).toBe(503);
 const cookie=s.req('/member/statements/prepare',{},s.input.token);cookie.headers.set('cookie','session=x');expect((await s.app.fetch(cookie,{peer:'fixture-peer'})).status).toBe(403);
});
test('peer budgets cover unauthenticated requests and stalled bodies release admission',async()=>{
 const limited=await setup({maximumRequests:1});expect((await limited.send('/auth/login/options',{})).status).toBe(200);expect((await limited.send('/auth/login/options',{})).status).toBe(429);
 const s=await setup({maximumPending:1});const stalled=new Request(config.origin+'/auth/login/options',{method:'POST',headers:{'content-type':'application/json'},body:new ReadableStream({start(){}})});
 const first=s.app.fetch(stalled,{peer:'fixture-peer'});expect((await s.send('/auth/login/options',{})).status).toBe(503);expect((await first).status).toBe(400);expect((await s.send('/auth/login/options',{})).status).toBe(200);
});
