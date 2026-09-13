import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { seedUnified, unifiedRuntime, loginResponse } from './unified-fixture.ts';
import { atomicScope } from './atomic-fixture.ts';
import { openAtomicStore } from './atomic-store.ts';
import { openMemberHTTP, memberRuntimeIdentity, type MemberRuntimeConfig } from './member-http.ts';
const cleanup:(()=>void)[]=[];afterEach(()=>{for(const f of cleanup.splice(0).reverse())f();});
const config:MemberRuntimeConfig={environment:'test',origin:atomicScope.audience,rpID:'unit.example',explorationRate:0.2,reminderLimit:1,recoveryGraceDays:3,dayBoundary:'UTC',maximumLifetimeMs:60000,maxSessionLifetimeMs:100000,maximumBodyBytes:20000,bodyTimeoutMs:1000,maximumPending:8,budgetWindowMs:60000,maximumRequests:100,maximumTrackedTokens:100};
async function setup(overrides:Partial<MemberRuntimeConfig>={}){const dir=mkdtempSync(join(tmpdir(),'member-http-'));cleanup.push(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'db.sqlite'),seeded=await seedUnified(path),unit=openAtomicStore(path,atomicScope);cleanup.push(()=>unit.close());await unit.run((store,db)=>unifiedRuntime(store,db).journal.cancel(seeded.input.token,seeded.input.operation.id));const selected={...config,...overrides},app=await openMemberHTTP(path,selected);cleanup.push(()=>app.close());const req=(route:string,body?:unknown,token=seeded.input.token)=>new Request(config.origin+route,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const prepare=async()=>{const res=await app.fetch(req('/member/statements/prepare',{offer:seeded.input.statement.offer,disputed:[]}));expect(res.status).toBe(200);return res.json();};return {dir,path,...seeded,unit,app,req,prepare,config:selected};}
test('authenticated member prepare submit and signature-free outcome preserve exact result',async()=>{
 const s=await setup(),p=await s.prepare(),proof=loginResponse(s.pair,s.input.credential,s.user,p.publicKey.challenge,2);
 const route='/member/operations/'+p.operationID;
 expect(await (await s.app.fetch(s.req(route+'/outcome'))).json()).toMatchObject({operationState:'prepared',receipt:null});
 const submitted=await s.app.fetch(s.req(route+'/submit',{assertion:proof}));expect(submitted.status).toBe(200);const result=await submitted.json();
 const outcome=await s.app.fetch(s.req(route+'/outcome'));expect(outcome.status).toBe(200);expect(outcome.headers.get('cache-control')).toBe('no-store');expect(await outcome.json()).toEqual(result);
 expect(await (await s.app.fetch(s.req(route+'/submit',{assertion:proof}))).json()).toEqual(result);
 expect(await s.unit.run((store,db)=>unifiedRuntime(store,db).engine.householdLedger.forHousehold('house'))).toHaveLength(1);
});
test('missing foreign and revoked sessions cannot read or submit member operations',async()=>{
 const s=await setup(),p=await s.prepare(),route='/member/operations/'+p.operationID;
 expect((await s.app.fetch(new Request(config.origin+route))).status).toBe(401);
 const foreign=await s.unit.run((store,db)=>{const r=unifiedRuntime(store,db);r.authority.provisionPrincipal('foreign','another-house',[]);r.authority.registerCredential('foreign-credential','foreign');return r.authority.createSessionAfterVerification('foreign-credential',1_800_000_001_000).token;});
 expect((await s.app.fetch(s.req(route,undefined,foreign))).status).toBe(404);
 // A correctly shaped unrecognised bearer has no access, regardless of supplied resource ID.
 expect((await s.app.fetch(s.req(route,undefined,'amr1_'+'a'.repeat(43)))).status).toBe(404);
 await s.unit.run((store,db)=>unifiedRuntime(store,db).authority.revokeCredential(s.input.credential));
 expect((await s.app.fetch(s.req(route+'/outcome'))).status).toBe(404);
 expect((await s.app.fetch(s.req(route+'/submit',{assertion:loginResponse(s.pair,s.input.credential,s.user,p.publicKey.challenge,2)}))).status).toBe(404);
});
test('reference administrative routes and runtime injection fields never reach member operations',async()=>{
 const s=await setup();for(const route of ['/households/house/import','/identities','/offers','/member/statements/prepare?household=foreign'])expect((await s.app.fetch(s.req(route,{}))).status).toBe(route.includes('?')?400:404);
 expect((await s.app.fetch(s.req('/member/statements/prepare',{offer:s.input.statement.offer,disputed:[],household:'foreign'}))).status).toBe(404);
 expect((await s.app.fetch(new Request(config.origin+'/member/statements/prepare',{method:'POST',headers:{authorization:'Bearer '+s.input.token,origin:'https://foreign.example','content-type':'application/json'},body:'{}'}))).status).toBe(400);
});
test('runtime fingerprint is stable across key ordering and mismatched configuration cannot reopen selection',async()=>{
 const s=await setup(),reordered=Object.fromEntries(Object.entries(s.config).reverse()) as MemberRuntimeConfig;
 expect(memberRuntimeIdentity(reordered).fingerprint).toBe(s.app.descriptor.fingerprint);
 const same=await openMemberHTTP(s.path,reordered);same.close();
 await expect(openMemberHTTP(s.path,{...s.config,explorationRate:0.3})).rejects.toThrow('runtime mismatch');
 expect(()=>memberRuntimeIdentity({...s.config,remoteProvider:'x'} as MemberRuntimeConfig)).toThrow();
});
test('derived fingerprint follows cutover and only selected active target serves member requests',async()=>{
 const s=await setup(),p=await s.prepare(),plan=await s.app.prepareCutover(join(s.dir,'target'));
 expect(plan.runtime).toBe(s.app.descriptor.fingerprint);expect((await s.app.fetch(s.req('/member/operations/'+p.operationID))).status).toBe(503);
 await s.app.activateCutover(plan.ticket);
 await expect(openMemberHTTP(plan.target,{...s.config,maximumRequests:101})).rejects.toThrow('runtime mismatch');
 const target=await openMemberHTTP(plan.target,s.config);cleanup.push(()=>target.close());
 expect((await target.fetch(s.req('/member/operations/'+p.operationID))).status).toBe(200);
 expect((await s.app.fetch(s.req('/member/operations/'+p.operationID))).status).toBe(503);
});
test('token request budgets body bounds and cancellation are enforced',async()=>{
 const s=await setup({maximumRequests:2}),p=await s.prepare();
 expect((await s.app.fetch(s.req('/member/operations/'+p.operationID+'/cancel',{}))).status).toBe(200);
 expect((await s.app.fetch(s.req('/member/operations/'+p.operationID+'/outcome'))).status).toBe(429);
 const bounded=await setup({maximumBodyBytes:8});expect((await bounded.app.fetch(bounded.req('/member/statements/prepare',{offer:'x'.repeat(100),disputed:[]}))).status).toBe(400);
});
test('owned committed outcome refuses corrupted receipt rather than reporting success',async()=>{
 const s=await setup(),p=await s.prepare(),route='/member/operations/'+p.operationID;
 expect((await s.app.fetch(s.req(route+'/submit',{assertion:loginResponse(s.pair,s.input.credential,s.user,p.publicKey.challenge,2)}))).status).toBe(200);
 const db=new Database(s.path);const row=db.query("SELECT v FROM atomic_rows WHERE namespace='settlements' AND k=?").get(s.input.statement.offer) as {v:string};const receipt=JSON.parse(row.v);receipt.charged++;db.query("UPDATE atomic_rows SET v=? WHERE namespace='settlements' AND k=?").run(JSON.stringify(receipt),s.input.statement.offer);db.close();
 expect((await s.app.fetch(s.req(route+'/outcome'))).status).toBe(404);
});

test('stalled bodies release admission after timeout and concurrent excess is refused',async()=>{
 const s=await setup({maximumPending:1,bodyTimeoutMs:25});
 const stalled=new Request(config.origin+'/member/statements/prepare',{method:'POST',headers:{authorization:'Bearer '+s.input.token,'content-type':'application/json'},body:new ReadableStream({start(){}})});
 const first=s.app.fetch(stalled);
 expect((await s.app.fetch(s.req('/member/statements/prepare',{}))).status).toBe(503);
 expect((await first).status).toBe(400);
 await s.prepare();
});
