import {beforeAll,afterAll,expect,test} from 'bun:test';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Database} from 'bun:sqlite';
import {createPool,initialiseDeployment,postgresStore,type Identity} from './store.ts';
import {migrateDatabase} from './migrate.ts';
import {openPostgresMemberHTTP} from './http.ts';
import {memberRuntime} from './runtime.ts';
import type {MemberRuntimeConfig} from './config.ts';
import {seedUnified,loginResponse} from '../member-transactions/unified-fixture.ts';
import {fixtureTime} from '../member-transactions/atomic-fixture.ts';
import {syntheticAuthenticator} from '../member-login/fixtures/authenticator.ts';
const url=process.env.ATARASY_TEST_POSTGRES_URL;if(!url)throw new Error('Explicit isolated ATARASY_TEST_POSTGRES_URL required');
const pool=createPool(url),ids:string[]=[];
const config:MemberRuntimeConfig={environment:'test',origin:'https://unit.example',rpID:'unit.example',explorationRate:0.2,reminderLimit:1,recoveryGraceDays:3,dayBoundary:'UTC',maximumLifetimeMs:60000,maxSessionLifetimeMs:100000,maximumBodyBytes:20000,bodyTimeoutMs:100,maximumPending:8,budgetWindowMs:60000,maximumRequests:100,maximumTrackedTokens:100};
const now=()=>fixtureTime+1;
beforeAll(()=>migrateDatabase(url));afterAll(async()=>{for(const id of ids){await pool.query('DELETE FROM atarasy_member.engine_rows WHERE deployment=$1',[id]);await pool.query('DELETE FROM atarasy_member.control WHERE id=$1',[id]);}await pool.end();});
async function setup(overrides:Partial<MemberRuntimeConfig>={}){
 const identity:Identity={id:'http_'+randomUUID().replaceAll('-',''),environment:'test',origin:config.origin,epoch:1};ids.push(identity.id);await initialiseDeployment(pool,identity);
 const c={...config,...overrides},unit=postgresStore(pool,identity),app=await openPostgresMemberHTTP(pool,identity,c,now);
 const dir=mkdtempSync(join(tmpdir(),'postgres-http-')),path=join(dir,'fixture.sqlite');let seeded:Awaited<ReturnType<typeof seedUnified>>;
 try{seeded=await seedUnified(path);const db=new Database(path,{readonly:true});try{
 const rows=db.query('SELECT namespace,k,v FROM atomic_rows ORDER BY rowid').all() as {namespace:string;k:string;v:string}[];
 await unit.run(store=>{const maps=new Map<string,Map<string,unknown>>();for(const r of rows){let map=maps.get(r.namespace);if(!map){map=store.map(r.namespace);maps.set(r.namespace,map);}map.set(r.k,JSON.parse(r.v));}});
 }finally{db.close();}}finally{rmSync(dir,{recursive:true,force:true});}
 const jwk=seeded.pair.publicKey.export({format:'jwk'}),cose=Buffer.concat([Buffer.from('a5010203262001215820','hex'),Buffer.from(jwk.x!,'base64url'),Buffer.from('225820','hex'),Buffer.from(jwk.y!,'base64url')]);
 const grant=await unit.run(store=>{const r=memberRuntime(store,c,now);r.authority.provisionPrincipal('member','house',['merchant-1']);r.authority.registerCredential(seeded.input.credential,'member');r.login.provisionVerifiedPasskey(seeded.input.credential,cose,1,seeded.user);r.authority.bindResource({kind:'mandate',id:'mandate-1'},{household:'house'});r.authority.bindResource({kind:'offer',id:seeded.input.statement.offer},{household:'house',presenter:'merchant-1'});const grant=r.authority.createSessionAfterVerification(seeded.input.credential,now()+90000);r.bindings.bind(grant.token,'mandate-1');return grant;});
 const request=(path:string,body?:unknown,token?:string)=>new Request(c.origin+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const send=(path:string,body?:unknown,token=grant.token)=>app.fetch(request(path,body,token),{peer:'fixture-peer'});
 const invite=()=>unit.run(store=>{const r=memberRuntime(store,c,now);r.authority.provisionPrincipal('new-member','house',['merchant-1']);return r.enrollment.issueInvitation('new-member');});
 return {identity,c,unit,app,grant,request,send,invite,...seeded};
}
test('PostgreSQL HTTP signs in reads approves reconciles identical retries and logs out',async()=>{
 const s=await setup(),flow=await (await s.send('/auth/login/options',{})).json();const signed=loginResponse(s.pair,s.input.credential,s.user,flow.publicKey.challenge,2);
 const login=await s.send('/auth/login/verify',{id:flow.id,response:signed});expect(login.status).toBe(200);const grant=await login.json();
 for(const path of ['/auth/session','/offers?household=house&presenter=merchant-1','/offers/'+s.input.statement.offer,'/offers/'+s.input.statement.offer+'/statement'])expect((await s.send(path,undefined,grant.token)).status).toBe(200);
 const reply=await s.send('/member/statements/prepare',{offer:s.input.statement.offer,disputed:[]},grant.token);expect(reply.status).toBe(200);const p=await reply.json();
 const assertion=loginResponse(s.pair,s.input.credential,s.user,p.publicKey.challenge,3),path='/member/operations/'+p.operationID;
 const second=await openPostgresMemberHTTP(pool,s.identity,s.c,now);
 const responses=await Promise.all([s.send(path+'/submit',{assertion},grant.token),second.fetch(s.request(path+'/submit',{assertion},grant.token),{peer:'other-peer'})]);
 expect(responses.map(r=>r.status)).toEqual([200,200]);const receipt=await responses[0]!.json();expect(await responses[1]!.json()).toEqual(receipt);
 expect(await (await s.send(path+'/outcome',undefined,grant.token)).json()).toEqual(receipt);
 expect((await s.send('/auth/logout',{},grant.token)).status).toBe(204);expect((await s.send(path+'/outcome',undefined,grant.token)).status).toBe(404);
});
test('PostgreSQL registration persists login across independent composition and rejects replay',async()=>{
 const s=await setup(),key=syntheticAuthenticator(),invitation=await s.invite(),flow=await (await s.send('/auth/enrollment/options',{invitation:invitation.token})).json();
 const response=key.register(flow.publicKey.challenge,config.origin,config.rpID);
 expect((await s.send('/auth/enrollment/verify',{id:flow.id,response})).status).toBe(201);expect((await s.send('/auth/enrollment/verify',{id:flow.id,response})).status).toBe(401);
 const login=await (await s.send('/auth/login/options',{})).json();const reply=await s.send('/auth/login/verify',{id:login.id,response:key.authenticate(login.publicKey.challenge,config.origin,config.rpID,flow.publicKey.user.id)});expect(reply.status).toBe(200);
 const fresh=await openPostgresMemberHTTP(pool,s.identity,s.c,now);expect((await fresh.fetch(s.request('/auth/session',undefined,(await reply.json()).token),{peer:'fresh'})).status).toBe(200);
});
test('failed activation consumes ceremony but rolls back the inserted passkey',async()=>{
 const s=await setup(),key=syntheticAuthenticator(),invitation=await s.invite();await s.unit.run(store=>memberRuntime(store,s.c,now).authority.registerCredential(key.id,'new-member'));
 const flow=await (await s.send('/auth/enrollment/options',{invitation:invitation.token})).json();
 expect((await s.send('/auth/enrollment/verify',{id:flow.id,response:key.register(flow.publicKey.challenge,config.origin,config.rpID)})).status).toBe(401);
 const snapshot=await s.unit.run(store=>({passkey:store.map('member_passkeys').has(key.id),flow:store.map('member_flows').has(flow.id)}));expect(snapshot).toEqual({passkey:false,flow:false});
});
test('revocation between prepare and submit prevents settlement and cancellation is durable',async()=>{
 const s=await setup(),p=await (await s.send('/member/statements/prepare',{offer:s.input.statement.offer,disputed:[]})).json();
 await s.unit.run(store=>memberRuntime(store,s.c,now).authority.revokeCredential(s.input.credential));
 expect((await s.send('/member/operations/'+p.operationID+'/submit',{assertion:loginResponse(s.pair,s.input.credential,s.user,p.publicKey.challenge,2)})).status).toBe(404);
 expect(await s.unit.run(store=>memberRuntime(store,s.c,now).engine.settlement(s.input.statement.offer)??null)).toBeNull();
 const other=await setup(),review=await (await other.send('/member/statements/prepare',{offer:other.input.statement.offer,disputed:[]})).json();expect((await other.send('/member/operations/'+review.operationID+'/cancel',{})).status).toBe(200);expect((await (await other.send('/member/operations/'+review.operationID+'/outcome')).json()).operationState).toBe('cancelled');
});
test('shared admission fences independent instances and bad login remains spent',async()=>{
 const s=await setup({maximumRequests:1}),second=await openPostgresMemberHTTP(pool,s.identity,s.c,now);
 expect((await s.send('/auth/login/options',{})).status).toBe(200);expect((await second.fetch(s.request('/auth/login/options',{}),{peer:'fixture-peer'})).status).toBe(429);
 const t=await setup(),flow=await (await t.send('/auth/login/options',{})).json();expect((await t.send('/auth/login/verify',{id:flow.id,response:{}})).status).toBe(401);
 expect((await t.send('/auth/login/verify',{id:flow.id,response:loginResponse(t.pair,t.input.credential,t.user,flow.publicKey.challenge,2)})).status).toBe(401);
 expect((await t.send('/identities',{})).status).toBe(404);expect((await t.app.fetch(t.request('/auth/session'),{peer:''})).status).toBe(503);
 await pool.query('UPDATE atarasy_member.control SET enabled=false WHERE id=$1',[t.identity.id]);expect((await t.send('/auth/session')).status).toBe(503);
});
test('PostgreSQL constraint rejects two blocking operations even through trusted raw store writes',async()=>{
 const s=await setup();await expect(s.unit.run(store=>{const operations=store.map('member_operations');operations.set('one',{offer:'same',state:'prepared'});operations.set('two',{offer:'same',state:'prepared'});})).rejects.toThrow('one_blocking_member_statement');
 expect(await s.unit.run(store=>store.map('member_operations').size)).toBe(0);
});
test('expired or wrong-challenge approval cannot consume a prepared operation',async()=>{
 const s=await setup(),p=await (await s.send('/member/statements/prepare',{offer:s.input.statement.offer,disputed:[]})).json(),path='/member/operations/'+p.operationID;
 const invalid=loginResponse(s.pair,s.input.credential,s.user,'wrong',2);expect((await s.send(path+'/submit',{assertion:invalid})).status).toBe(404);
 expect((await (await s.send(path+'/outcome')).json()).operationState).toBe('prepared');
 const expired=await openPostgresMemberHTTP(pool,s.identity,s.c,()=>now()+61000);expect((await expired.fetch(s.request(path+'/submit',{assertion:loginResponse(s.pair,s.input.credential,s.user,p.publicKey.challenge,2)},s.grant.token),{peer:'expiry'})).status).toBe(404);
 expect(await s.unit.run(store=>memberRuntime(store,s.c,now).engine.settlement(s.input.statement.offer)??null)).toBeNull();
});
