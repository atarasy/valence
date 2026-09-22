import { signConfig } from '../../engine/test/helpers.ts';
import {beforeAll,afterAll,expect,test} from 'bun:test';
import {canonicalWithdrawal,canonicalDecisions} from '../../engine/src/shared/decisions.ts';
import {canonicalMandate} from '../../engine/src/hub/mandates.ts';
import {createCipheriv,createHash,createPublicKey,randomBytes,randomUUID,sign} from 'node:crypto';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Database} from 'bun:sqlite';
import {createPool,initialiseDeployment,postgresStore,type Identity} from './store.ts';
import {migrateDatabase} from './migrate.ts';
import {openPostgresMemberHTTP} from './http.ts';
import {credentialSPKI} from '../member-login/credential-key.ts';
import {isHouseholdName,nameOf} from '../../engine/src/common/names.ts';
import {memberRuntime} from './runtime.ts';
import {presenterCredentials} from './presenter-http.ts';
import type {MemberRuntimeConfig} from './config.ts';
import {seedUnified,loginResponse} from '../member-transactions/unified-fixture.ts';
import {fixtureTime} from '../member-transactions/atomic-fixture.ts';
import {syntheticAuthenticator} from '../member-login/fixtures/authenticator.ts';
import {MERCHANT_PAIR} from '../../engine/test/helpers.ts';
import {canonicalCorrection} from '../../engine/src/shared/correction.ts';
const url=process.env.ATARASY_TEST_POSTGRES_URL;if(!url)throw new Error('Explicit isolated ATARASY_TEST_POSTGRES_URL required');
const pool=createPool(url),ids:string[]=[];
const config:MemberRuntimeConfig={environment:'test',origin:'https://unit.example',rpID:'unit.example',androidAppOrigins:[],explorationRate:0.2,reminderLimit:1,recoveryGraceDays:3,dayBoundary:'UTC',maximumLifetimeMs:60000,maxSessionLifetimeMs:100000,maximumBodyBytes:20000,bodyTimeoutMs:100,maximumPending:8,budgetWindowMs:60000,maximumRequests:100,maximumTrackedTokens:100};
const now=()=>fixtureTime+1;
const coseOf=(pair:{publicKey:{export:(o:any)=>any}})=>{const jwk=pair.publicKey.export({format:'jwk'});return Buffer.concat([Buffer.from('a5010203262001215820','hex'),Buffer.from(jwk.x!,'base64url'),Buffer.from('225820','hex'),Buffer.from(jwk.y!,'base64url')]);};
const engineAssertion=(response:{response:{clientDataJSON:string;authenticatorData:string;signature:string}})=>{const value=response.response,b64=(input:string)=>Buffer.from(input,'base64url').toString('base64');return {client_data_json:b64(value.clientDataJSON),authenticator_data:b64(value.authenticatorData),signature:b64(value.signature)};};
const loginResponseAt=(pair:{privateKey:any},credential:string,user:string,challenge:string,counter:number,origin:string,rpID:string)=>{const digest=(input:string|Buffer)=>createHash('sha256').update(input).digest(),client=Buffer.from(JSON.stringify({type:'webauthn.get',challenge,origin})),count=Buffer.alloc(4);count.writeUInt32BE(counter);const auth=Buffer.concat([digest(rpID),Buffer.from([5]),count]);return{id:credential,rawId:credential,type:'public-key' as const,clientExtensionResults:{},response:{clientDataJSON:client.toString('base64url'),authenticatorData:auth.toString('base64url'),signature:sign('sha256',Buffer.concat([auth,digest(client)]),pair.privateKey).toString('base64url'),userHandle:user}};};
// The invited member is a second household, so its identifier is a second key (§13.2, question 55).
// The invited member has not registered a passkey, so it has no household yet
// (§13.2, question 55): a household that is a key is adopted, not assigned.
beforeAll(()=>migrateDatabase(url));afterAll(async()=>{for(const id of ids){await pool.query('DELETE FROM atarasy_member.engine_rows WHERE deployment=$1',[id]);await pool.query('DELETE FROM atarasy_member.control WHERE id=$1',[id]);}await pool.end();});
async function setup(overrides:Partial<MemberRuntimeConfig>={}){
 const identity:Identity={id:'http_'+randomUUID().replaceAll('-',''),environment:'test',origin:config.origin,epoch:1};ids.push(identity.id);await initialiseDeployment(pool,identity);
 const c={...config,...overrides},unit=postgresStore(pool,identity),app=await openPostgresMemberHTTP(pool,identity,c,now);
 const dir=mkdtempSync(join(tmpdir(),'postgres-http-')),path=join(dir,'fixture.sqlite');let seeded:Awaited<ReturnType<typeof seedUnified>>;
 try{seeded=await seedUnified(path);const db=new Database(path,{readonly:true});try{
 const rows=db.query('SELECT namespace,k,v FROM atomic_rows ORDER BY rowid').all() as {namespace:string;k:string;v:string}[];
 await unit.run(store=>{const maps=new Map<string,Map<string,unknown>>();for(const r of rows){let map=maps.get(r.namespace);if(!map){map=store.map(r.namespace);maps.set(r.namespace,map);}map.set(r.k,JSON.parse(r.v));}});
 }finally{db.close();}}finally{rmSync(dir,{recursive:true,force:true});}
 const cose=coseOf(seeded.pair);
 const request=(path:string,body?:unknown,token?:string)=>new Request(c.origin+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const grant=await unit.run(store=>{const r=memberRuntime(store,c,now);
  r.authority.provisionUnclaimedPrincipal('member',['merchant-1']);
  r.authority.registerCredential(seeded.input.credential,'member');
  r.login.provisionVerifiedPasskey(seeded.input.credential,cose,1,seeded.user);
  // `seedUnified` ran a real login ceremony with this exact pair in its own
  // store, so the assertion this stands for was made. Nothing here invents a
  // proof: the verification path is exercised over HTTP in the registration
  // test below, and the refusal without one is asserted there too.
  r.authority.markCredentialProven(seeded.input.credential);
  r.authority.adoptHousehold('member',seeded.input.credential);
  r.authority.bindResource({kind:'mandate',id:seeded.input.mandate},{household:seeded.input.house});
  r.authority.bindResource({kind:'offer',id:seeded.input.statement.offer},{household:seeded.input.house,presenter:'merchant-1'});
  const grant=r.authority.createSessionAfterVerification(seeded.input.credential,now()+90000);
  r.bindings.bind(grant.token,seeded.input.mandate);return grant;});
 const send=(path:string,body?:unknown,token=grant.token)=>app.fetch(request(path,body,token),{peer:'fixture-peer'});
 const invite=()=>unit.run(store=>{const r=memberRuntime(store,c,now);r.authority.provisionUnclaimedPrincipal('new-member',['merchant-1']);return r.enrollment.issueInvitation('new-member');});
 return {identity,c,unit,app,grant,request,send,invite,...seeded};
}
test('PostgreSQL HTTP signs in reads approves reconciles identical retries and logs out',async()=>{
 const s=await setup(),flow=await (await s.send('/auth/login/options',{})).json();const signed=loginResponse(s.pair,s.input.credential,s.user,flow.publicKey.challenge,2);
 const login=await s.send('/auth/login/verify',{id:flow.id,response:signed});expect(login.status).toBe(200);const grant=await login.json();
 // The mandate route is in the list because a path filter of `[A-Za-z0-9_-]+`
 // answered 404 for every identifier question 55 produces, so a household could
 // not read its own mandate anywhere. Measured by a refutation pass 2026-09-16.
 for(const path of ['/auth/session','/offers?household='+encodeURIComponent(s.input.house)+'&presenter=merchant-1','/offers/'+s.input.statement.offer,'/offers/'+s.input.statement.offer+'/statement','/_node/mandates/'+encodeURIComponent(s.input.mandate),'/_node/mandates/'+s.input.mandate])expect((await s.send(path,undefined,grant.token)).status).toBe(200);
 const reply=await s.send('/member/statements/prepare',{offer:s.input.statement.offer,disputed:[]},grant.token);expect(reply.status).toBe(200);const p=await reply.json();
 const assertion=loginResponse(s.pair,s.input.credential,s.user,p.publicKey.challenge,3),path='/member/operations/'+p.operationID;
 const second=await openPostgresMemberHTTP(pool,s.identity,s.c,now);
 const responses=await Promise.all([s.send(path+'/submit',{assertion},grant.token),second.fetch(s.request(path+'/submit',{assertion},grant.token),{peer:'other-peer'})]);
 expect(responses.map(r=>r.status)).toEqual([200,200]);const receipt=await responses[0]!.json();expect(await responses[1]!.json()).toEqual(receipt);
 expect(await (await s.send(path+'/outcome',undefined,grant.token)).json()).toEqual(receipt);
 expect((await s.send('/auth/logout',{},grant.token)).status).toBe(204);expect((await s.send(path+'/outcome',undefined,grant.token)).status).toBe(404);
});
test('configured Android release origin enrolls logs in and signs while an unlisted certificate is refused',async()=>{
 const androidOrigin='android:apk-key-hash:'+Buffer.alloc(32,7).toString('base64url'),s=await setup({androidAppOrigins:[androidOrigin]});
 const enrolledKey=syntheticAuthenticator(),invitation=await s.invite(),enrollment=await(await s.send('/auth/enrollment/options',{invitation:invitation.token})).json();
 expect((await s.send('/auth/enrollment/verify',{id:enrollment.id,response:enrolledKey.register(enrollment.publicKey.challenge,androidOrigin,s.c.rpID)})).status).toBe(201);
 const flow=await(await s.send('/auth/login/options',{})).json(),signed=loginResponseAt(s.pair,s.input.credential,s.user,flow.publicKey.challenge,2,androidOrigin,s.c.rpID),login=await s.send('/auth/login/verify',{id:flow.id,response:signed});
 expect(login.status).toBe(200);const token=(await login.json()).token as string,prepared=await(await s.send('/member/statements/prepare',{offer:s.input.statement.offer,disputed:[]},token)).json();
 const assertion=loginResponseAt(s.pair,s.input.credential,s.user,prepared.publicKey.challenge,3,androidOrigin,s.c.rpID);
 expect((await s.send('/member/operations/'+prepared.operationID+'/submit',{assertion},token)).status).toBe(200);
 const foreign='android:apk-key-hash:'+Buffer.alloc(32,8).toString('base64url'),next=await(await s.send('/auth/login/options',{})).json();
 expect((await s.send('/auth/login/verify',{id:next.id,response:loginResponseAt(s.pair,s.input.credential,s.user,next.publicKey.challenge,4,foreign,s.c.rpID)})).status).toBe(401);
});
test('member mandate changes read the effective version and wait for every prior co-signer',async()=>{
 const s=await setup(),co=syntheticAuthenticator();
 await s.unit.run(store=>{const r=memberRuntime(store,s.c,now);r.authority.provisionUnclaimedPrincipal('mandate-cosigner',[]);});
 const invitation=await s.unit.run(store=>memberRuntime(store,s.c,now).enrollment.issueInvitation('mandate-cosigner'));
 const enrollment=await (await s.send('/auth/enrollment/options',{invitation:invitation.token})).json();
 expect((await s.send('/auth/enrollment/verify',{id:enrollment.id,response:co.register(enrollment.publicKey.challenge,s.c.origin,s.c.rpID)})).status).toBe(201);
 const login=await (await s.send('/auth/login/options',{})).json(),user=enrollment.publicKey.user.id;
 const signedIn=await s.send('/auth/login/verify',{id:login.id,response:co.authenticate(login.publicKey.challenge,s.c.origin,s.c.rpID,user,1)});
 expect(signedIn.status).toBe(200);const coToken=(await signedIn.json()).token as string;
 const coSigner=await s.unit.run(store=>{const r=memberRuntime(store,s.c,now),name=r.authority.adoptHousehold('mandate-cosigner',co.id),key=r.login.verifiedPublicKey(co.id)!;
  r.engine.registerIdentity(name,createPublicKey({key:credentialSPKI(key),format:'der',type:'spki'}).export({type:'spki',format:'pem'}).toString());return name;});
 const effective=await (await s.send('/member/mandates/effective',undefined)).json();
 expect(effective.mandates).toHaveLength(1);const first=effective.mandates[0];
 const addSigner={...first,co_signers:[coSigner],version:first.version+1,lapses_at:first.lapses_at-1};
 const prepared=await (await s.send('/member/mandates/changes',{mandate:addSigner})).json();
 expect(prepared).toMatchObject({before:first,mandate:addSigner,requiredSigners:[s.input.house],signedBy:[],state:'pending'});
 const memberProof=engineAssertion(loginResponse(s.pair,s.input.credential,s.user,prepared.publicKey.challenge,10));
 const tightened=await (await s.send('/member/mandates/changes/'+prepared.id+'/submit',{assertion:memberProof})).json();
 expect(tightened).toMatchObject({state:'effective',signedBy:[s.input.house]});
 const loosened={...addSigner,ceiling_out_of_network:addSigner.ceiling_out_of_network+1,version:addSigner.version+1};
 const joint=await (await s.send('/member/mandates/changes',{mandate:loosened})).json();
 expect(joint.requiredSigners).toEqual([coSigner,s.input.house].sort());
 const memberJoint=engineAssertion(loginResponse(s.pair,s.input.credential,s.user,joint.publicKey.challenge,11));
 const waiting=await (await s.send('/member/mandates/changes/'+joint.id+'/submit',{assertion:memberJoint})).json();
 expect(waiting.state).toBe('pending');expect(waiting.signedBy).toEqual([s.input.house]);
 const competing=await s.send('/member/mandates/changes',{mandate:{...loosened,ceiling_out_of_network:loosened.ceiling_out_of_network+1}});
 expect(competing.status).toBe(409);expect(await competing.json()).toEqual({error:'change_pending'});
 const coList=await (await s.send('/member/mandates/changes',undefined,coToken)).json();
 expect(coList.changes.map((value:{id:string})=>value.id)).toContain(joint.id);
 const coPrepared=await (await s.send('/member/mandates/changes/'+joint.id+'/prepare',undefined,coToken)).json();
 const coProof=engineAssertion(co.authenticate(coPrepared.publicKey.challenge,s.c.origin,s.c.rpID,user,2));
 const completed=await (await s.send('/member/mandates/changes/'+joint.id+'/submit',{assertion:coProof},coToken)).json();
 expect(completed).toMatchObject({state:'effective',mandate:loosened});expect(completed.signedBy.sort()).toEqual([coSigner,s.input.house].sort());
 const readback=await (await s.send('/member/mandates/effective',undefined)).json();
 expect(readback.mandates).toEqual([loosened]);
 const stale=await s.send('/member/mandates/changes',{mandate:loosened});expect(stale.status).toBe(409);expect(await stale.json()).toEqual({error:'stale_version'});
 const invalid=await s.send('/member/mandates/changes',{mandate:{...loosened,version:loosened.version+1,cooling_seconds:2_592_001}});
 expect(invalid.status).toBe(422);expect(await invalid.json()).toEqual({error:'invalid_cooling'});
 const unchanged=await s.send('/member/mandates/changes',{mandate:{...loosened,version:loosened.version+1}});
 expect(unchanged.status).toBe(422);expect(await unchanged.json()).toEqual({error:'no_change'});
 const malformed=await s.send('/member/mandates/changes',{mandate:{id:loosened.id}});
 expect(malformed.status).toBe(400);expect(await malformed.json()).toEqual({error:'invalid_mandate'});
});
test('PostgreSQL registration persists login across independent composition and rejects replay',async()=>{
 const s=await setup(),key=syntheticAuthenticator(),invitation=await s.invite(),flow=await (await s.send('/auth/enrollment/options',{invitation:invitation.token})).json();
 const response=key.register(flow.publicKey.challenge,config.origin,config.rpID);
 expect((await s.send('/auth/enrollment/verify',{id:flow.id,response})).status).toBe(201);expect((await s.send('/auth/enrollment/verify',{id:flow.id,response})).status).toBe(401);
 // §10.5 and question 55. Enrolment runs with `attestationType: 'none'`, so a
 // registered public key is a value the client sent and nothing signed. A
 // refutation pass on 2026-09-16 enrolled another household's key, adopted that
 // household and read its offers, statement and mandate. Both halves are here:
 // a key that has signed nothing cannot name a household, and a key that is
 // somebody else's is exactly such a key.
 await expect(s.unit.run(store=>{const r=memberRuntime(store,s.c,now);return r.authority.adoptHousehold('new-member',key.id);})).rejects.toThrow('Credential has proven no key');
 const borrowed=randomUUID().replaceAll('-','');
 await expect(s.unit.run(store=>{const r=memberRuntime(store,s.c,now);
  r.authority.registerCredential(borrowed,'new-member');
  r.login.provisionVerifiedPasskey(borrowed,coseOf(s.pair),0,randomUUID().replaceAll('-',''));
  return r.authority.adoptHousehold('new-member',borrowed);})).rejects.toThrow('Credential has proven no key');
 expect(await s.unit.run(store=>store.map<{household:string|null}>('member_principals').get('new-member')?.household)).toBeNull();
 const login=await (await s.send('/auth/login/options',{})).json();const reply=await s.send('/auth/login/verify',{id:login.id,response:key.authenticate(login.publicKey.challenge,config.origin,config.rpID,flow.publicKey.user.id)});expect(reply.status).toBe(200);
 const token=(await reply.json()).token as string;
 // §13.2, question 55. A device that has enrolled holds a session and no
 // household until it adopts one from its own key, so there is nothing yet to
 // read with. The adoption derives the name from the registered credential.
 const fresh=await openPostgresMemberHTTP(pool,s.identity,s.c,now);
 expect((await fresh.fetch(s.request('/auth/session',undefined,token),{peer:'fresh'})).status).toBe(401);
 const adopted=await s.unit.run(store=>{const r=memberRuntime(store,s.c,now);return r.authority.adoptHousehold('new-member',key.id);});
 expect(isHouseholdName(adopted)).toBe(true);
 // The authority's own return, not the engine's later refusal: for four commits
 // the name came from the caller, and `name_is_not_the_key` in `registerIdentity`
 // was what stood behind it. Nothing in that path runs here.
 expect(await s.unit.run(store=>{const row=store.map<{public_key:number[]}>('member_passkeys').get(key.id)!;
  return nameOf(createPublicKey({key:credentialSPKI(new Uint8Array(row.public_key)),format:'der',type:'spki'}).export({type:'spki',format:'pem'}).toString());})).toBe(adopted);
 const after=await openPostgresMemberHTTP(pool,s.identity,s.c,now);
 const session=await after.fetch(s.request('/auth/session',undefined,token),{peer:'fresh'});
 expect(session.status).toBe(200);expect((await session.json()).household).toBe(adopted);
});
test('a refused credential leaves no passkey row, because the authority refuses first',async()=>{
 // NOTE (mutation check, 2026-09-18): enrolment_writes_before_the_refusal. It
 // survived the package's first corpus, because the caller wraps the enrolment
 // in a savepoint, so writing the passkey before the authority refuses rolls
 // back and is invisible from outside. **The rule that is left is the order**,
 // and the order is only visible from inside the store.
 const s=await setup(),key=syntheticAuthenticator();
 const written:string[]=[];
 await expect(s.unit.run(store=>{
  // The store's own identity carries its savepoint, so the map is replaced on
  // the object rather than wrapped in a copy. The store belongs to this run.
  const opened=store.map.bind(store);
  (store as {map:unknown}).map=<V,>(namespace:string)=>{
   const inner=opened<V>(namespace);
   return new Proxy(inner,{get(target,property,receiver){
    const value=Reflect.get(target,property,receiver);
    if(property==='set'||property==='delete'||property==='clear')return (...args:unknown[])=>{written.push(namespace);return (value as (...a:unknown[])=>unknown).apply(target,args);};
    return typeof value==='function'?value.bind(target):value;
   }}) as Map<string,V>;
  };
  // 'member' adopted its household in setup, so it takes no further credential.
  memberRuntime(store,s.c,now).login.enrolVerifiedPasskey('member',key.id,coseOf(s.pair),0,randomUUID().replaceAll('-',''));
 })).rejects.toThrow('takes no further credential');
 expect(written.filter(n=>n==='member_passkeys')).toEqual([]);
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
test('an expired unsigned operation is refused by the next prepare instead of blocking the offer',async()=>{
 const s=await setup(),first=await (await s.send('/member/statements/prepare',{offer:s.input.statement.offer,disputed:[]})).json();
 // Before expiry the same operation is returned, so a retry cannot fork a second one.
 expect((await (await s.send('/member/statements/prepare',{offer:s.input.statement.offer,disputed:[]})).json()).operationID).toBe(first.operationID);
 const later=()=>now()+61000,app=await openPostgresMemberHTTP(pool,s.identity,s.c,later),at=(path:string,body?:unknown)=>app.fetch(s.request(path,body,s.grant.token),{peer:'later'});
 const reply=await at('/member/statements/prepare',{offer:s.input.statement.offer,disputed:[]});expect(reply.status).toBe(200);const second=await reply.json();
 expect(second.operationID).not.toBe(first.operationID);expect(second.operationState).toBe('prepared');
 expect((await (await at('/member/operations/'+first.operationID+'/outcome')).json()).operationState).toBe('refused');
 const submitted=await at('/member/operations/'+second.operationID+'/submit',{assertion:loginResponse(s.pair,s.input.credential,s.user,second.publicKey.challenge,2)});
 expect(submitted.status).toBe(200);expect((await submitted.json()).operationState).toBe('committed');
});

// Digital decisions reuse the verified member identity and database unit, but
// carry a distinct signed profile and a frozen decision result rather than a payment receipt.
async function digitalSetup(quote=true){
 const s=await setup();
 // Finish the fixture's earlier physical statement before presenting another offer.
 const previous=await (await s.send('/member/statements/prepare',{offer:s.input.statement.offer,disputed:[]})).json();
 expect((await s.send('/member/operations/'+previous.operationID+'/submit',{assertion:loginResponse(s.pair,s.input.credential,s.user,previous.publicKey.challenge,2)})).status).toBe(200);
 const offer=await s.unit.run(async store=>{
  const r=memberRuntime(store,s.c,now);
  const catalogue={version:'digital-cfg',presenter:'merchant-1',products:{'digital-tea':r.engine.configsForPresenter('merchant-1')[0]!.products['tea-0']!}};
  r.engine.registerConfig(catalogue,signConfig(catalogue));
  const o=r.engine.createOffer({binding:'digital',household:s.input.house,purpose:'replenish',config_version:'digital-cfg',expires_at:fixtureTime+3600000,mandate:s.input.mandate,price_band:null,giver:null,candidates:[{product:'digital-tea',quantity:1,predicted_conversion:null,is_exploration:true,given_by:null}]});
  await r.engine.present(o.id,now());
  const {ApprovalDesk}=await import('../../engine/src/hub/approval.ts');
  new ApprovalDesk(store).record({offer:o.id,perCandidate:Object.fromEntries(o.candidates.map(c=>[c.id,{alternatives:['Use existing supplies'],argument_against:'You may already have enough.'}])),excluded:[],mandate:{kind:'standing',scope:'Test supplies',lapses_at:fixtureTime+10000000}});
  r.authority.bindResource({kind:'offer',id:o.id},{household:s.input.house,presenter:'merchant-1'});
  return o;
 });
 const presenterToken=await s.unit.run(store=>presenterCredentials(memberRuntime(store,s.c,now)).issue('merchant-1','Synthetic merchant',now()).token);
 if(quote)expect((await s.send('/presenter/offers/'+offer.id+'/carriage-quote',{carriage:550},presenterToken)).status).toBe(201);
 expect(await s.unit.run(store=>memberRuntime(store,s.c,now).deliveries.find(offer.id))).toBeUndefined();
 const decisions=offer.candidates.map(c=>({candidate:c.id,valence:'kept',kept_as:'self'}));
 const prepare=()=>s.send('/member/decisions/prepare',{offer:offer.id,decisions});
 return {...s,offer,decisions,prepare,presenterToken};
}
test('digital decision commits once across independent HTTP runtimes and retains the original result',async()=>{
 const s=await digitalSetup(),detail=await (await s.send('/offers/'+s.offer.id)).json(),reply=await s.prepare();expect(reply.status).toBe(200);const p=await reply.json();
 expect(p.profile).toBe('atarasy.member-decision-authorisation.1');expect(p.review.goods).toBe(1200);expect(p.review.carriage).toBe(550);expect(p.review.total).toBe(1750);
 const repeated=await (await s.prepare()).json();expect(repeated.operationID).toBe(p.operationID);
 const assertion=loginResponse(s.pair,s.input.credential,s.user,p.publicKey.challenge,3),path='/member/operations/'+p.operationID;
 const second=await openPostgresMemberHTTP(pool,s.identity,s.c,now);
 const replies=await Promise.all([s.send(path+'/submit',{assertion}),second.fetch(s.request(path+'/submit',{assertion},s.grant.token),{peer:'digital-other'})]);
 expect(replies.map(r=>r.status)).toEqual([200,200]);const result=await replies[0]!.json();expect(await replies[1]!.json()).toEqual(result);
 expect(result.operationState).toBe('committed');expect(result.decision.state).toBe('decided');expect(result.decision.candidates[0].valence).toBe('kept');
 expect(result.receipt).toBeUndefined();
 if(process.env.ATARASY_DIGITAL_FIXTURE_OUTPUT){
  writeFileSync(process.env.ATARASY_DIGITAL_FIXTURE_OUTPUT,JSON.stringify({serviceBase:'25d8ca7',scope:'Synthetic PostgreSQL HTTP prepare and decision result; no provider or native authenticator.',environment:{name:s.c.environment,origin:s.c.origin},session:await(await s.send('/auth/session')).json(),detail,prepared:p,committed:result},null,2)+'\n',{flag:'wx',mode:0o600});
 }
 // Advance the offer independently; recovery still returns exactly what this decision recorded.
 await s.unit.run(store=>memberRuntime(store,s.c,now).engine.settle(s.offer.id,now()));
 // Another composition reads the saved result without sending a signature again.
 const fresh=await openPostgresMemberHTTP(pool,s.identity,s.c,now);
 expect(await (await fresh.fetch(s.request(path+'/outcome',undefined,s.grant.token),{peer:'digital-restart'})).json()).toEqual(result);
 expect((await s.send(path+'/submit',{assertion:loginResponse(s.pair,s.input.credential,s.user,p.publicKey.challenge,4)})).status).toBe(404);
 expect((await s.send(path+'/cancel',{})).status).toBe(404);
 const stored=await s.unit.run(store=>{const r=memberRuntime(store,s.c,now);return {state:r.engine.mustGet(s.offer.id,now()).state,operation:r.operations.find(o=>o.id===p.operationID)};});
 expect(stored.state).toBe('settled');expect(stored.operation?.kind).toBe('digital_decision');expect(stored.operation?.state).toBe('committed');
});
test('digital cancelled and expired preparations cannot be dispatched and can be replaced',async()=>{
 const s=await digitalSetup(),p=await (await s.prepare()).json(),path='/member/operations/'+p.operationID;
 expect(await (await s.send(path+'/cancel',{})).json()).toEqual({cancelled:true});
 expect((await s.send(path+'/submit',{assertion:loginResponse(s.pair,s.input.credential,s.user,p.publicKey.challenge,3)})).status).toBe(404);
 const second=await (await s.prepare()).json();expect(second.operationID).not.toBe(p.operationID);
 const later=()=>now()+60001,app=await openPostgresMemberHTTP(pool,s.identity,s.c,later);
 expect((await app.fetch(s.request('/member/operations/'+second.operationID+'/submit',{assertion:loginResponse(s.pair,s.input.credential,s.user,second.publicKey.challenge,3)},s.grant.token),{peer:'expired'})).status).toBe(404);
 const replacement=await app.fetch(s.request('/member/decisions/prepare',{offer:s.offer.id,decisions:s.decisions},s.grant.token),{peer:'replace'});
 expect(replacement.status).toBe(200);expect((await replacement.json()).operationID).not.toBe(second.operationID);
});
test('digital changed review, missing carriage and cross-household access refuse without effect',async()=>{
 const s=await digitalSetup(),p=await (await s.prepare()).json(),path='/member/operations/'+p.operationID;
 await s.unit.run(store=>{const rows=store.map<any>('deliberations'),v=rows.get(s.offer.id);v.perCandidate[s.offer.candidates[0]!.id].argument_against='Changed terms';rows.set(s.offer.id,v);});
 expect((await s.send(path+'/submit',{assertion:loginResponse(s.pair,s.input.credential,s.user,p.publicKey.challenge,3)})).status).toBe(404);
 expect(await s.unit.run(store=>memberRuntime(store,s.c,now).engine.mustGet(s.offer.id,now()).state)).toBe('presented');
 // A scoped token for another household cannot discover the preparation.
 const outsider=await setup();
 const other=await s.unit.run(store=>{const r=memberRuntime(store,s.c,now);
  r.authority.provisionUnclaimedPrincipal('outsider',['merchant-1']);
  r.authority.registerCredential(outsider.input.credential,'outsider');
  r.login.provisionVerifiedPasskey(outsider.input.credential,coseOf(outsider.pair),1,outsider.user);
  r.authority.markCredentialProven(outsider.input.credential);r.authority.adoptHousehold('outsider',outsider.input.credential);
  return r.authority.createSessionAfterVerification(outsider.input.credential,now()+90000);
 });
 expect((await s.send('/auth/session',undefined,other.token)).status).toBe(200);
 for(const suffix of ['', '/outcome'])expect((await s.send(path+suffix,undefined,other.token)).status).toBe(404);
 expect((await s.send('/member/decisions/prepare',{offer:s.offer.id,decisions:s.decisions},other.token)).status).toBe(404);
 await s.send(path+'/cancel',{});
 await s.unit.run(store=>store.map('carriage_quotes').delete(s.offer.id));
 expect((await s.prepare()).status).toBe(404);
 expect((await s.send('/member/decisions/prepare',{offer:s.offer.id,decisions:[]})).status).toBe(404);
});
test('digital database write failure rolls back the engine decision, operation and counter',async()=>{
 const s=await digitalSetup(),p=await (await s.prepare()).json(),path='/member/operations/'+p.operationID;
 const assertion=loginResponse(s.pair,s.input.credential,s.user,p.publicKey.challenge,3);
 // A trigger scoped to this fixture fails a persisted decided offer after in-memory verification.
 const fn='fail_digital_'+randomUUID().replaceAll('-','');
 await pool.query(`CREATE FUNCTION atarasy_member.${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.deployment = '${s.identity.id}' AND NEW.namespace = 'offers' AND NEW.value::jsonb->>'state' = 'decided' THEN RAISE EXCEPTION 'injected decision write failure'; END IF; RETURN NEW; END $$`);
 await pool.query(`CREATE TRIGGER ${fn} BEFORE INSERT OR UPDATE ON atarasy_member.engine_rows FOR EACH ROW EXECUTE FUNCTION atarasy_member.${fn}()`);
 try{
  expect((await s.send(path+'/submit',{assertion})).status).toBe(503);
  const state=await s.unit.run(store=>{const r=memberRuntime(store,s.c,now);return {offer:r.engine.mustGet(s.offer.id,now()).state,operation:r.operations.find(o=>o.id===p.operationID)?.state};});
  expect(state).toEqual({offer:'presented',operation:'prepared'});
 }finally{await pool.query(`DROP TRIGGER ${fn} ON atarasy_member.engine_rows`);await pool.query(`DROP FUNCTION atarasy_member.${fn}()`);}
 // Same assertion/counter remains usable because its counter write rolled back too.
 expect((await s.send(path+'/submit',{assertion})).status).toBe(200);
});
test('digital explicit refusal survives a discarded submit response without another signature',async()=>{
 const s=await digitalSetup(),decisions=s.offer.candidates.map(c=>({candidate:c.id,valence:'returned'}));
 const p=await (await s.send('/member/decisions/prepare',{offer:s.offer.id,decisions})).json();
 const path='/member/operations/'+p.operationID;
 await s.send(path+'/submit',{assertion:loginResponse(s.pair,s.input.credential,s.user,p.publicKey.challenge,3)});
 // The response is intentionally discarded; the client only retains the original operation ID.
 const fresh=await openPostgresMemberHTTP(pool,s.identity,s.c,now);
 const response=await fresh.fetch(s.request(path+'/outcome',undefined,s.grant.token),{peer:'lost-response'});
 expect(response.status).toBe(200);const value=await response.json();
 expect(value.operationState).toBe('committed');expect(value.decision.state).toBe('settled');
 expect(value.decision.candidates.every((c:any)=>c.valence==='returned')).toBe(true);
 expect(await s.unit.run(store=>memberRuntime(store,s.c,now).engine.settlement(s.offer.id)?.charged)).toBe(0);
});

test('digital approval uses quoted carriage and never treats a fabricated delivery as a quote',async()=>{
 const s=await digitalSetup(false);
 await s.unit.run(store=>memberRuntime(store,s.c,now).deliveries.record({offer:s.offer.id,carriage:999,code:'fixture-only',status:'placed',now:now()}));
 expect((await s.prepare()).status).toBe(404);
 expect((await (await s.send('/offers/'+s.offer.id+'/approval')).json()).carriage).toBeNull();
 await s.send('/presenter/offers/'+s.offer.id+'/carriage-quote',{carriage:550},s.presenterToken);
 expect((await (await s.send('/offers/'+s.offer.id+'/approval')).json()).carriage).toBe(550);
 const p=await (await s.prepare()).json();expect(p.review.carriage).toBe(550);
 // A corrupted trusted row must invalidate the prepared revision before verification.
 await s.unit.run(store=>{const rows=store.map<any>('carriage_quotes'),q=rows.get(s.offer.id);rows.set(s.offer.id,{...q,carriage:551});});
 expect((await s.send('/member/operations/'+p.operationID+'/submit',{assertion:loginResponse(s.pair,s.input.credential,s.user,p.publicKey.challenge,3)})).status).toBe(404);
 expect(await s.unit.run(store=>memberRuntime(store,s.c,now).engine.mustGet(s.offer.id,now()).state)).toBe('presented');
});

// Optional cross-repository contract probe: an explicitly named local Vox checkout,
// a local transport bridge and this disposable PostgreSQL deployment. No hosted calls.
test.skipIf(!process.env.VOX_TEST_SOURCE)('Vox service quotation and permission request reach authenticated member decisions',async()=>{
 const root=process.env.VOX_TEST_SOURCE!,s=await digitalSetup(false);
 const {createValenceClient}=await import(root+'/src/service/valenceClient.ts');
 const {createHandler}=await import(root+'/src/service/server.ts');
 const {ensureRole,loadKeys}=await import(root+'/src/service/keys.ts');
 const app=await openPostgresMemberHTTP(pool,s.identity,s.c,now),bridge=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
   const url=new URL(request.url);return app.fetch(new Request(s.c.origin+url.pathname+url.search,{method:request.method,headers:request.headers,...(request.method==='GET'?{}:{body:await request.text()})}),{peer:'vox-local-bridge'});
 }});
 const dir=mkdtempSync(join(tmpdir(),'vox-quote-contract-'));
 try{
  ensureRole(dir,'presenter','merchant-1');ensureRole(dir,'merchant','merchant-1');
  const origin='http://127.0.0.1:'+bridge.port,handler=createHandler({keys:loadKeys(dir),valence:createValenceClient(origin,s.presenterToken),webDist:dir,origin,allowedHosts:['vox.local']});
  const access=await handler(new Request('http://vox.local/api/access-requests',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({household:s.input.house,product:'digital-tea',product_name:'Digital tea',review_expires_at:now()+5000,access_expires_at:now()+10000})}));
  expect(access.status).toBe(201);const review=await access.json() as any;expect(review.terms.requester).toEqual({id:'merchant-1',name:'Synthetic merchant'});
  const memberReview=await(await s.send('/member/permissions/requests/'+review.terms.requestID)).json();expect(memberReview.digest).toBe(review.digest);
  const granted=await(await s.send('/member/permissions/requests/'+review.terms.requestID+'/grant',{digest:review.digest})).json();expect(granted.permission.scope).toEqual(['duplicate_check']);
  const checked=()=>handler(new Request('http://vox.local/api/access-requests/'+review.terms.requestID+'/duplicate-check',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}));
  expect(await(await checked()).json()).toEqual({already_received:false});
  await s.send('/member/permissions/revoke',{permission:granted.permission.id});expect((await checked()).status).toBe(404);
  const quote=()=>handler(new Request('http://vox.local/api/offers/'+s.offer.id+'/carriage-quote',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({carriage:550})}));
  const response=await quote();expect(response.status).toBe(200);const first=await response.json();expect(await(await quote()).json()).toEqual(first);
  const detail=await(await s.send('/presenter/offers/'+s.offer.id,undefined,s.presenterToken)).json();expect(detail.delivery).toBeNull();expect(detail.carriage_quote).toEqual(first);
  const approval=await(await s.send('/offers/'+s.offer.id+'/approval')).json();expect(approval.carriage).toBe(550);
  const p=await(await s.prepare()).json();expect(p.review.carriage).toBe(550);expect(p.review.total).toBe(1750);
  const committed=await s.send('/member/operations/'+p.operationID+'/submit',{assertion:loginResponse(s.pair,s.input.credential,s.user,p.publicKey.challenge,3)});
  expect(committed.status).toBe(200);expect((await committed.json()).operationState).toBe('committed');
  expect(await(await quote()).json()).toEqual(first);
 }finally{bridge.stop(true);rmSync(dir,{recursive:true,force:true});}
});

// Journal-only probes deliberately use trusted synthetic proof digests. They
// establish storage/transition guarantees, not a verified withdrawal ceremony.
test('digital journal preserves committed history while advancing exactly one incarnation',async()=>{
 const s=await digitalSetup(),p=await(await s.prepare()).json(),path='/member/operations/'+p.operationID;
 const original=await(await s.send(path+'/submit',{assertion:loginResponse(s.pair,s.input.credential,s.user,p.publicKey.challenge,3)})).json();
 // Legacy committed rows predate the optional incarnation field.
 await s.unit.run(store=>{const rows=store.map<any>('member_operations'),old=rows.get(p.operationID);delete old.incarnation;rows.set(p.operationID,old);});
 const prepareWithdrawal=()=>s.unit.run(async store=>{const r=memberRuntime(store,s.c,now),d=await r.journal.read(s.grant.token,p.operationID);return r.journal.prepare(s.grant.token,{offer:d.offer,mandate:d.mandate,presenter:d.presenter,canonical:'valence.member-withdrawal.1\n'+d.offer+'\nfixture',reviewedRevision:'a'.repeat(64),expiresAt:now()+60000},'digital_withdrawal');});
 const raced=await Promise.all([prepareWithdrawal(),prepareWithdrawal()]);expect(raced[0]!.id).toBe(raced[1]!.id);
 const made=await s.unit.run(async store=>{
  const r=memberRuntime(store,s.c,now),d=await r.journal.read(s.grant.token,p.operationID);
  const terms={offer:d.offer,mandate:d.mandate,presenter:d.presenter,canonical:'valence.member-withdrawal.1\n'+d.offer+'\nfixture',reviewedRevision:'a'.repeat(64),expiresAt:now()+60000};
  const w=await r.journal.prepare(s.grant.token,terms,'digital_withdrawal');
  expect(()=>r.journal.advanceAfterWithdrawal(s.grant.token,d.id,w.id)).toThrow('transition');
  await r.journal.claimVerified(s.grant.token,w.id,{requestDigest:w.requestDigest,reviewedRevision:w.reviewedRevision,assertionFingerprint:'b'.repeat(64)});
  r.journal.recordCommitted(w.id,'b'.repeat(64),'c'.repeat(64));
  expect(r.journal.advanceAfterWithdrawal(s.grant.token,d.id,w.id)).toBe(1);
  expect(r.journal.advanceAfterWithdrawal(s.grant.token,d.id,w.id)).toBe(1);
  const next=await r.journal.prepare(s.grant.token,{offer:d.offer,mandate:d.mandate,presenter:d.presenter,canonical:d.canonical,reviewedRevision:'d'.repeat(64),expiresAt:now()+60000},'digital_decision');
  expect(next.incarnation).toBe(1);expect(next.id).not.toBe(d.id);expect((await r.journal.read(s.grant.token,d.id)).state).toBe('committed');
  return {d,w,next};
 });
 expect(await(await s.send(path+'/outcome')).json()).toEqual(original);
 await s.unit.run(async store=>{const r=memberRuntime(store,s.c,now);expect(r.journal.currentIncarnation(s.offer.id)).toBe(1);expect(await r.journal.read(s.grant.token,made.w.id)).toEqual({...made.w,state:'committed',assertionFingerprint:'b'.repeat(64),receiptDigest:'c'.repeat(64)});expect((await r.journal.read(s.grant.token,made.next.id)).incarnation).toBe(1);});
 // A second blocking decision in the same incarnation is still refused by PostgreSQL.
 await expect(s.unit.run(store=>{store.map('member_operations').set('duplicate-next',{...made.next,id:'duplicate-next'});})).rejects.toThrow('one_blocking_member_statement');
 await s.unit.run(async store=>{
  const r=memberRuntime(store,s.c,now),d=await r.journal.read(s.grant.token,made.next.id);
  await r.journal.claimVerified(s.grant.token,d.id,{requestDigest:d.requestDigest,reviewedRevision:d.reviewedRevision,assertionFingerprint:'e'.repeat(64)});r.journal.recordCommitted(d.id,'e'.repeat(64),'f'.repeat(64));
  const w=await r.journal.prepare(s.grant.token,{offer:d.offer,mandate:d.mandate,presenter:d.presenter,canonical:'valence.member-withdrawal.1\n'+d.offer+'\nnext',reviewedRevision:'1'.repeat(64),expiresAt:now()+60000},'digital_withdrawal');
  await r.journal.claimVerified(s.grant.token,w.id,{requestDigest:w.requestDigest,reviewedRevision:w.reviewedRevision,assertionFingerprint:'2'.repeat(64)});r.journal.recordCommitted(w.id,'2'.repeat(64),'3'.repeat(64));
  expect(r.journal.advanceAfterWithdrawal(s.grant.token,d.id,w.id)).toBe(2);
  expect(()=>r.journal.advanceAfterWithdrawal(s.grant.token,made.d.id,made.w.id)).toThrow('Stale');
 });
 expect(await(await s.send(path+'/outcome')).json()).toEqual(original);
 // An arbitrary physical incarnation never bypasses the old one-per-offer constraint.
 await expect(s.unit.run(store=>{const rows=store.map('member_operations');rows.set('physical-one',{offer:'physical-test',kind:'physical_statement',state:'prepared',incarnation:1});rows.set('physical-two',{offer:'physical-test',kind:'physical_statement',state:'prepared',incarnation:2});})).rejects.toThrow('one_blocking_member_statement');
});

test('advancing a decision incarnation rolls back with the enclosing unit and rejects corrupt heads',async()=>{
 const s=await digitalSetup(),p=await(await s.prepare()).json();
 await s.send('/member/operations/'+p.operationID+'/submit',{assertion:loginResponse(s.pair,s.input.credential,s.user,p.publicKey.challenge,3)});
 await expect(s.unit.run(async store=>{
  const r=memberRuntime(store,s.c,now),d=await r.journal.read(s.grant.token,p.operationID);
  const w=await r.journal.prepare(s.grant.token,{offer:d.offer,mandate:d.mandate,presenter:d.presenter,canonical:'valence.member-withdrawal.1\n'+d.offer+'\nfixture',reviewedRevision:'a'.repeat(64),expiresAt:now()+60000},'digital_withdrawal');
  await r.journal.claimVerified(s.grant.token,w.id,{requestDigest:w.requestDigest,reviewedRevision:w.reviewedRevision,assertionFingerprint:'b'.repeat(64)});r.journal.recordCommitted(w.id,'b'.repeat(64),'c'.repeat(64));
  r.journal.advanceAfterWithdrawal(s.grant.token,d.id,w.id);throw new Error('fixture unit failure');
 })).rejects.toThrow('fixture unit failure');
 await s.unit.run(store=>{const r=memberRuntime(store,s.c,now);expect(r.journal.currentIncarnation(s.offer.id)).toBe(0);expect(r.operations.find(o=>o.kind==='digital_withdrawal')).toBeNull();});
 await s.unit.run(store=>{store.map('member_decision_heads').set(s.offer.id,{offer:s.offer.id,incarnation:1,decision:p.operationID,withdrawal:'absent'});});
 await expect(s.unit.run(store=>memberRuntime(store,s.c,now).journal.currentIncarnation(s.offer.id))).rejects.toThrow('unavailable');
});


async function withdrawalSetup(cooling:number|null=3600,lifetime?:number){
 const s=await digitalSetup();
 await s.unit.run(store=>{
  const r=memberRuntime(store,s.c,now),old=r.engine.mandates.mustGet(s.input.mandate,now()),mandate={...old,cooling_seconds:cooling,version:old.version+1,...(lifetime===undefined?{}:{lapses_at:now()+lifetime})};
  r.engine.mandates.record({mandate,signatures:{[s.input.house]:sign('sha256',canonicalMandate(mandate,s.c.rpID),s.pair.privateKey).toString('base64')},assertions:{},keyOf:k=>r.engine.publicKeyFor(k),relyingPartyId:s.c.rpID,now:now()});
 });
 const decision=await(await s.prepare()).json();
 const decided=await(await s.send('/member/operations/'+decision.operationID+'/submit',{assertion:loginResponse(s.pair,s.input.credential,s.user,decision.publicKey.challenge,3)})).json();
 expect(decided.operationState).toBe('committed');
 const prepareWithdrawal=()=>s.send('/member/withdrawals/prepare',{decisionOperationID:decision.operationID});
 return {...s,decision,decided,prepareWithdrawal};
}
test('authenticated withdrawal commits once, permits redecision and preserves both historical outcomes',async()=>{
 const s=await withdrawalSetup(),prepared=await s.prepareWithdrawal();expect(prepared.status).toBe(200);const w=await prepared.json(),path='/member/operations/'+w.operationID;
 expect(w.profile).toBe('atarasy.member-withdrawal-authorisation.1');expect(w.review.decisionOperationID).toBe(s.decision.operationID);expect(w.review.incarnation).toBe(0);
 expect((await(await s.prepareWithdrawal()).json()).operationID).toBe(w.operationID);
 const assertion=loginResponse(s.pair,s.input.credential,s.user,w.publicKey.challenge,4),other=await openPostgresMemberHTTP(pool,s.identity,s.c,now);
 const replies=await Promise.all([s.send(path+'/submit',{assertion}),other.fetch(s.request(path+'/submit',{assertion},s.grant.token),{peer:'second-withdrawal'})]);
 expect(replies.map(r=>r.status)).toEqual([200,200]);const first=await replies[0]!.json();expect(await replies[1]!.json()).toEqual(first);
 expect(first.withdrawal.nextIncarnation).toBe(1);expect(first.withdrawal.offer.state).toBe('presented');expect(first.withdrawal.offer.candidates[0].valence).toBe('offered');
 const next=await(await s.prepare()).json();expect(next.operationID).not.toBe(s.decision.operationID);
 const redecisionReply=await s.send('/member/operations/'+next.operationID+'/submit',{assertion:loginResponse(s.pair,s.input.credential,s.user,next.publicKey.challenge,5)});expect(redecisionReply.status).toBe(200);const redecision=await redecisionReply.json();
 if(process.env.ATARASY_WITHDRAWAL_FIXTURE_OUTPUT)writeFileSync(process.env.ATARASY_WITHDRAWAL_FIXTURE_OUTPUT,JSON.stringify({contract:'atarasy.member-withdrawal-authorisation.1',scope:'Synthetic PostgreSQL HTTP decision, withdrawal and redecision; no native authenticator or provider.',environment:{name:s.c.environment,origin:s.c.origin},session:await(await s.send('/auth/session')).json(),decisionPrepared:s.decision,decisionOutcome:s.decided,withdrawalPrepared:w,withdrawalOutcome:first,redecisionPrepared:next,redecisionOutcome:redecision},null,2)+'\n',{flag:'wx',mode:0o600});
 // Both generations have exactly the fixture clock's timestamp; old withdrawal still reads its original result.
 const restarted=await openPostgresMemberHTTP(pool,s.identity,s.c,now);
 expect(await(await restarted.fetch(s.request(path+'/outcome',undefined,s.grant.token),{peer:'restarted-withdrawal'})).json()).toEqual(first);
 expect(await(await s.send('/member/operations/'+s.decision.operationID+'/outcome')).json()).toEqual(s.decided);
 expect(await(await s.send(path+'/submit',{assertion})).json()).toEqual(first);
 expect((await s.prepareWithdrawal()).status).toBe(404);
 const second=await s.send('/member/withdrawals/prepare',{decisionOperationID:next.operationID});expect(second.status).toBe(200);const w2=await second.json();expect(w2.review.incarnation).toBe(1);expect(w2.canonical).not.toBe(w.canonical);
 expect((await s.send('/member/operations/'+w2.operationID+'/submit',{assertion})).status).toBe(404);
 expect((await s.send(path+'/cancel',{})).status).toBe(404);
});

test('withdrawal cancellation, expiry, missing cooling and foreign authority refuse without effect',async()=>{
 const s=await withdrawalSetup(),w=await(await s.prepareWithdrawal()).json(),path='/member/operations/'+w.operationID;
 expect((await s.send(path+'/cancel',{})).status).toBe(200);
 expect((await s.send(path+'/submit',{assertion:loginResponse(s.pair,s.input.credential,s.user,w.publicKey.challenge,4)})).status).toBe(404);
 const next=await(await s.prepareWithdrawal()).json();expect(next.operationID).not.toBe(w.operationID);
 const later=()=>now()+60001,app=await openPostgresMemberHTTP(pool,s.identity,s.c,later);
 expect((await app.fetch(s.request('/member/operations/'+next.operationID+'/submit',{assertion:loginResponse(s.pair,s.input.credential,s.user,next.publicKey.challenge,4)},s.grant.token),{peer:'expired-withdrawal'})).status).toBe(404);
 const replacement=await app.fetch(s.request('/member/withdrawals/prepare',{decisionOperationID:s.decision.operationID},s.grant.token),{peer:'replace-withdrawal'});expect(replacement.status).toBe(200);
 const noCooling=await withdrawalSetup(null);expect((await noCooling.prepareWithdrawal()).status).toBe(404);
 const closed=await withdrawalSetup(1),closedApp=await openPostgresMemberHTTP(pool,closed.identity,closed.c,()=>now()+1000);
 expect((await closedApp.fetch(closed.request('/member/withdrawals/prepare',{decisionOperationID:closed.decision.operationID},closed.grant.token),{peer:'closed-cooling'})).status).toBe(404);
 for(const suffix of ['', '/outcome'])expect((await s.send(path+suffix,undefined,noCooling.grant.token)).status).toBe(404);
 expect((await s.send('/member/withdrawals/prepare',{decisionOperationID:s.decision.operationID,offer:s.offer.id})).status).toBe(404);
 expect(await s.unit.run(store=>memberRuntime(store,s.c,now).engine.mustGet(s.offer.id,now()).state)).toBe('decided');
});

test('withdrawal late database failure rolls back engine, passkey counter, result and successor head',async()=>{
 const s=await withdrawalSetup(),w=await(await s.prepareWithdrawal()).json(),path='/member/operations/'+w.operationID,assertion=loginResponse(s.pair,s.input.credential,s.user,w.publicKey.challenge,4);
 const fn='fail_withdrawal_'+randomUUID().replaceAll('-','');
 await pool.query(`CREATE FUNCTION atarasy_member.${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.deployment = '${s.identity.id}' AND NEW.namespace = 'member_decision_heads' THEN RAISE EXCEPTION 'injected withdrawal write failure'; END IF; RETURN NEW; END $$`);
 await pool.query(`CREATE TRIGGER ${fn} BEFORE INSERT OR UPDATE ON atarasy_member.engine_rows FOR EACH ROW EXECUTE FUNCTION atarasy_member.${fn}()`);
 try{
  expect((await s.send(path+'/submit',{assertion})).status).toBe(503);
  expect(await s.unit.run(store=>{const r=memberRuntime(store,s.c,now);return {state:r.engine.mustGet(s.offer.id,now()).state,incarnation:r.journal.currentIncarnation(s.offer.id),operation:r.operations.find(o=>o.id===w.operationID)?.state};})).toEqual({state:'decided',incarnation:0,operation:'prepared'});
  expect((await(await s.send(path+'/outcome')).json()).withdrawal).toBeNull();
 }finally{await pool.query(`DROP TRIGGER ${fn} ON atarasy_member.engine_rows`);await pool.query(`DROP FUNCTION atarasy_member.${fn}()`);}
 // Reusing the same counter works only because the entire failed transaction rolled back.
 expect((await s.send(path+'/submit',{assertion})).status).toBe(200);
});


test('withdrawal retains the cooling right after the named mandate lapses',async()=>{
 const s=await withdrawalSetup(3600,100),later=()=>now()+101,app=await openPostgresMemberHTTP(pool,s.identity,s.c,later);
 const send=(path:string,body?:unknown)=>app.fetch(s.request(path,body,s.grant.token),{peer:'lapsed-mandate'});
 const prepared=await send('/member/withdrawals/prepare',{decisionOperationID:s.decision.operationID});expect(prepared.status).toBe(200);const w=await prepared.json();
 expect(w.review.mandate.lapses_at).toBeLessThan(later());expect(w.expiresAt).toBeGreaterThan(later());
 expect((await send('/member/operations/'+w.operationID+'/submit',{assertion:loginResponse(s.pair,s.input.credential,s.user,w.publicKey.challenge,4)})).status).toBe(200);
});

test('changed withdrawal review and revoked credential cannot advance the decision',async()=>{
 const s=await withdrawalSetup(),w=await(await s.prepareWithdrawal()).json(),path='/member/operations/'+w.operationID;
 await s.unit.run(store=>{const r=memberRuntime(store,s.c,now),old=r.engine.mandates.get(s.input.mandate)!,mandate={...old,cooling_seconds:7200,version:old.version+1};r.engine.mandates.record({mandate,signatures:{[s.input.house]:sign('sha256',canonicalMandate(mandate,s.c.rpID),s.pair.privateKey).toString('base64')},assertions:{},keyOf:k=>r.engine.publicKeyFor(k),relyingPartyId:s.c.rpID,now:now()});});
 expect((await s.send(path+'/submit',{assertion:loginResponse(s.pair,s.input.credential,s.user,w.publicKey.challenge,4)})).status).toBe(404);
 await s.send(path+'/cancel',{});const next=await(await s.prepareWithdrawal()).json();expect(next.operationID).not.toBe(w.operationID);
 await s.unit.run(store=>memberRuntime(store,s.c,now).authority.revokeCredential(s.input.credential));
 expect((await s.send('/member/operations/'+next.operationID+'/submit',{assertion:loginResponse(s.pair,s.input.credential,s.user,next.publicKey.challenge,4)})).status).toBe(404);
 expect(await s.unit.run(store=>{const r=memberRuntime(store,s.c,now);return {state:r.engine.mustGet(s.offer.id,now()).state,incarnation:r.journal.currentIncarnation(s.offer.id)};})).toEqual({state:'decided',incarnation:0});
});

test('discarded withdrawal response recovers by GET while a valid other-household session cannot read it',async()=>{
 const s=await withdrawalSetup(),w=await(await s.prepareWithdrawal()).json(),path='/member/operations/'+w.operationID;
 // Discard the body after dispatch and reopen with no assertion replay.
 await s.send(path+'/submit',{assertion:loginResponse(s.pair,s.input.credential,s.user,w.publicKey.challenge,4)});
 const app=await openPostgresMemberHTTP(pool,s.identity,s.c,now),recovered=await app.fetch(s.request(path+'/outcome',undefined,s.grant.token),{peer:'lost-withdrawal'});
 expect(recovered.status).toBe(200);expect((await recovered.json()).withdrawal.nextIncarnation).toBe(1);
 const outsider=await setup(),other=await s.unit.run(store=>{const r=memberRuntime(store,s.c,now);r.authority.provisionUnclaimedPrincipal('withdrawal-outsider',['merchant-1']);r.authority.registerCredential(outsider.input.credential,'withdrawal-outsider');r.login.provisionVerifiedPasskey(outsider.input.credential,coseOf(outsider.pair),1,outsider.user);r.authority.markCredentialProven(outsider.input.credential);r.authority.adoptHousehold('withdrawal-outsider',outsider.input.credential);return r.authority.createSessionAfterVerification(outsider.input.credential,now()+90000);});
 expect((await s.send('/auth/session',undefined,other.token)).status).toBe(200);
 for(const suffix of ['', '/outcome'])expect((await s.send(path+suffix,undefined,other.token)).status).toBe(404);
 expect((await s.send('/member/withdrawals/prepare',{decisionOperationID:s.decision.operationID},other.token)).status).toBe(404);
});


test('same-time same-content redecision outside the journal cannot substitute for the original decision',async()=>{
 const s=await withdrawalSetup(),w=await(await s.prepareWithdrawal()).json();
 await s.unit.run(async store=>{
  const r=memberRuntime(store,s.c,now),o=r.engine.mustGet(s.offer.id,now());
  await r.engine.withdrawDecisions(o.id,{signature:sign('sha256',canonicalWithdrawal(o.id,o.decided_at!),s.pair.privateKey).toString('base64')},now());
  await r.engine.decide(o.id,s.decisions as Parameters<typeof r.engine.decide>[1],sign('sha256',canonicalDecisions(o.id,s.decisions as Parameters<typeof r.engine.decide>[1]),s.pair.privateKey).toString('base64'),now());
  expect(r.engine.mustGet(o.id,now())).toEqual(s.decided.decision);
 });
 expect((await s.send('/member/operations/'+w.operationID+'/submit',{assertion:loginResponse(s.pair,s.input.credential,s.user,w.publicKey.challenge,4)})).status).toBe(404);
 await s.send('/member/operations/'+w.operationID+'/cancel',{});
 expect((await s.prepareWithdrawal()).status).toBe(404);
 expect(await s.unit.run(store=>memberRuntime(store,s.c,now).journal.currentIncarnation(s.offer.id))).toBe(0);
});

test('historical decision without generation metadata still reads but cannot invent a withdrawal association',async()=>{
 const s=await withdrawalSetup();
 await s.unit.run(store=>{const rows=store.map<any>('member_reviews'),old=rows.get(s.decision.operationID);delete old.decisionGeneration;rows.set(s.decision.operationID,old);});
 expect(await(await s.send('/member/operations/'+s.decision.operationID+'/outcome')).json()).toEqual(s.decided);
 expect((await s.prepareWithdrawal()).status).toBe(404);
});

test('disabled snapshot candidate preserves digital withdrawal history, successor review and passkey counter',async()=>{
 const {captureDeployment,restoreDeploymentCandidate,freezeDeployment,activateDeploymentCandidate}=await import('./operational-snapshot.ts');
 const s=await withdrawalSetup(),w=await(await s.prepareWithdrawal()).json();
 const withdrawal=await(await s.send('/member/operations/'+w.operationID+'/submit',{assertion:loginResponse(s.pair,s.input.credential,s.user,w.publicKey.challenge,4)})).json();
 expect(withdrawal.operationState).toBe('committed');
 const next=await(await s.prepare()).json(),snapshot=await freezeDeployment(pool,s.identity,randomUUID(),'f'.repeat(64));
 const db='snapshot_http_'+randomUUID().replaceAll('-',''),destinationURL=new URL(url!);destinationURL.pathname='/'+db;
 await pool.query(`CREATE DATABASE "${db}"`);const destination=createPool(destinationURL.toString());
 try{
  await migrateDatabase(destinationURL.toString());await restoreDeploymentCandidate(destination,snapshot,s.identity);
  expect((await captureDeployment(destination,s.identity)).rows.filter(r=>r.namespace!=='member_writer_target')).toEqual(snapshot.rows);
  await expect(postgresStore(destination,s.identity).run(()=>null)).rejects.toThrow('fenced');
  // Rehearse the implemented retire-before-enable protocol on synthetic databases.
  await expect(s.unit.run(()=>null)).rejects.toThrow('fenced');
  const ticket=JSON.parse(snapshot.rows.find(r=>r.namespace==='member_writer_migration')!.value).ticket;
  await activateDeploymentCandidate(pool,destination,s.identity,ticket,'f'.repeat(64));
  const app=await openPostgresMemberHTTP(destination,s.identity,s.c,now);
  const send=(path:string,body?:unknown)=>app.fetch(s.request(path,body,s.grant.token),{peer:'snapshot-target'});
  expect(await(await send('/member/operations/'+s.decision.operationID+'/outcome')).json()).toEqual(s.decided);
  expect(await(await send('/member/operations/'+w.operationID+'/outcome')).json()).toEqual(withdrawal);
  expect(await(await send('/member/operations/'+next.operationID)).json()).toEqual(next);
  const path='/member/operations/'+next.operationID+'/submit';
  expect((await send(path,{assertion:loginResponse(s.pair,s.input.credential,s.user,next.publicKey.challenge,4)})).status).toBe(404);
  expect((await send(path,{assertion:loginResponse(s.pair,s.input.credential,s.user,next.publicKey.challenge,5)})).status).toBe(200);
  await postgresStore(destination,s.identity).run(store=>{const r=memberRuntime(store,s.c,now);expect(r.journal.currentIncarnation(s.offer.id)).toBe(1);expect(r.quotes.find(s.offer.id)?.carriage).toBe(550);});
 }finally{await destination.end();await pool.query(`DROP DATABASE "${db}" WITH (FORCE)`);}
});

async function permissionSetup(){
 const s=await setup(),{PermissionLedger}=await import('../../engine/src/hub/permissions.ts');
 const permissions=await s.unit.run(store=>{const ledger=new PermissionLedger(store),action=ledger.openAction({household:s.input.house,describes:'Synthetic action-specific request',expiresAt:now()+60000});return ['first','second'].map(grantee=>ledger.grant({household:s.input.house,grantee,scope:['offers'],purpose:'Synthetic limited permission',expires_at:now()+5000,asked_from:action.id,now:now()}));});
 return {...s,permissions};
}
test('member lists only own permission history and revokes one grant idempotently across restart',async()=>{
 const s=await permissionSetup(),list=await s.send('/member/permissions/list');expect(list.status).toBe(200);expect(list.headers.get('cache-control')).toBe('no-store');const listed=await list.json();expect(listed.permissions).toEqual(s.permissions);
 const [a,b]=s.permissions;const revoked=await(await s.send('/member/permissions/revoke',{permission:a!.id})).json();expect(revoked.permission.revoked_at).toBe(now());
 const restarted=await openPostgresMemberHTTP(pool,s.identity,s.c,()=>now()+1);
 const retry=await restarted.fetch(s.request('/member/permissions/revoke',{permission:a!.id},s.grant.token),{peer:'permission-retry'});expect(await retry.json()).toEqual(revoked);
 const latest=await(await s.send('/member/permissions/list')).json();expect(latest.permissions.find((p:any)=>p.id===b!.id)).toEqual(b);
 if(process.env.ATARASY_PERMISSION_FIXTURE_OUTPUT)writeFileSync(process.env.ATARASY_PERMISSION_FIXTURE_OUTPUT,JSON.stringify({scope:'Synthetic PostgreSQL permission list and individual revocation; no native UI or new-grant ceremony.',environment:{name:s.c.environment,origin:s.c.origin},session:await(await s.send('/auth/session')).json(),listed,revoked,after:latest},null,2)+'\n',{flag:'wx',mode:0o600});
 const {PermissionLedger}=await import('../../engine/src/hub/permissions.ts');await s.unit.run(store=>{const ledger=new PermissionLedger(store);expect(ledger.forHousehold(s.input.house)).toHaveLength(2);});
});
test('permission routes reject foreign ids caller household injection revoked credentials and malformed requests',async()=>{
 const s=await permissionSetup(),other=await setup();
 const outsider=await s.unit.run(store=>{const r=memberRuntime(store,s.c,now);r.authority.provisionUnclaimedPrincipal('permission-outsider',['merchant-1']);r.authority.registerCredential(other.input.credential,'permission-outsider');r.login.provisionVerifiedPasskey(other.input.credential,coseOf(other.pair),1,other.user);r.authority.markCredentialProven(other.input.credential);r.authority.adoptHousehold('permission-outsider',other.input.credential);return r.authority.createSessionAfterVerification(other.input.credential,now()+90000);});
 expect((await(await s.send('/member/permissions/list',undefined,outsider.token)).json()).permissions).toEqual([]);
 expect((await s.send('/member/permissions/revoke',{permission:s.permissions[0]!.id},outsider.token)).status).toBe(404);
 for(const value of [{permission:s.permissions[0]!.id,household:s.input.house},{permission:'unknown'},{},[]])expect((await s.send('/member/permissions/revoke',value)).status).toBe(404);
 expect((await s.send('/member/permissions/list?household=foreign')).status).toBe(404);
 expect((await s.send('/member/permissions/list',{})).status).toBe(405);
 await s.unit.run(store=>memberRuntime(store,s.c,now).authority.revokeCredential(s.input.credential));expect((await s.send('/member/permissions/list')).status).toBe(404);
});
test('expired permissions remain in history but do not permit access; revocation leaves other grants effective',async()=>{
 const s=await permissionSetup(),{PermissionLedger}=await import('../../engine/src/hub/permissions.ts'),[first,second]=s.permissions;
 const allowed=(grantee:string,at:number)=>s.unit.run(store=>new PermissionLedger(store).allows({household:s.input.house,grantee,field:'offers',now:at}));
 expect(await allowed(first!.grantee,now())).toBe(true);await s.send('/member/permissions/revoke',{permission:first!.id});expect(await allowed(first!.grantee,now())).toBe(false);expect(await allowed(second!.grantee,now())).toBe(true);expect(await allowed(second!.grantee,second!.expires_at)).toBe(false);
 const later=await openPostgresMemberHTTP(pool,s.identity,s.c,()=>now()+5000);const list=await later.fetch(s.request('/member/permissions/list',undefined,s.grant.token),{peer:'expired-permissions'});expect((await list.json()).permissions).toHaveLength(2);
});
test('database failure during individual revocation preserves the full ledger for a later retry',async()=>{
 const s=await permissionSetup(),fn='fail_permission_'+randomUUID().replaceAll('-','');
 await pool.query(`CREATE FUNCTION atarasy_member.${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.deployment = '${s.identity.id}' AND NEW.namespace = 'permissions' THEN RAISE EXCEPTION 'injected permission failure'; END IF; RETURN NEW; END $$`);
 await pool.query(`CREATE TRIGGER ${fn} BEFORE INSERT OR UPDATE ON atarasy_member.engine_rows FOR EACH ROW EXECUTE FUNCTION atarasy_member.${fn}()`);
 try{expect((await s.send('/member/permissions/revoke',{permission:s.permissions[0]!.id})).status).toBe(503);expect((await(await s.send('/member/permissions/list')).json()).permissions).toEqual(s.permissions);}
 finally{await pool.query(`DROP TRIGGER ${fn} ON atarasy_member.engine_rows`);await pool.query(`DROP FUNCTION atarasy_member.${fn}()`);}
 expect((await s.send('/member/permissions/revoke',{permission:s.permissions[0]!.id})).status).toBe(200);
});

async function requestPermission(s:Awaited<ReturnType<typeof setup>>){
 const {openPermissionRequests}=await import('./permission-requests.ts');
 return s.unit.run(store=>openPermissionRequests(memberRuntime(store,s.c,now)).issueDuplicateCheck({household:s.input.house,product:'synthetic-product',productName:'synthetic tea',requester:{id:'giver-one',name:'Example giver'},reviewExpiresAt:now()+5000,accessExpiresAt:now()+10000}));
}
test('permission review freezes terms and grants exactly once across concurrent retries and restart',async()=>{
 const s=await setup(),review=await requestPermission(s),path='/member/permissions/requests/'+review.terms.requestID;
 expect((await(await s.send('/member/permissions/requests')).json()).requests).toEqual([review]);expect(await(await s.send(path)).json()).toEqual(review);
 for(const body of [{digest:'0'.repeat(64)},{digest:review.digest,scope:['offers']},{digest:review.digest,household:'foreign'},{}])expect((await s.send(path+'/grant',body)).status).toBe(404);
 expect((await(await s.send('/member/permissions/list')).json()).permissions).toEqual([]);
 const second=await openPostgresMemberHTTP(pool,s.identity,s.c,now),replies=await Promise.all([s.send(path+'/grant',{digest:review.digest}),second.fetch(s.request(path+'/grant',{digest:review.digest},s.grant.token),{peer:'retry'})]);
 expect(replies.map(r=>r.status)).toEqual([200,200]);const granted=await replies[0]!.json();expect(await replies[1]!.json()).toEqual(granted);
 expect(granted.state).toBe('granted');expect(granted.terms).toEqual(review.terms);expect(granted.permission.scope).toEqual(['duplicate_check']);expect(granted.permission.grantee).toBe(review.terms.requester.id);
 expect((await(await s.send('/member/permissions/list')).json()).permissions).toHaveLength(1);expect((await s.send(path+'/cancel',{digest:review.digest})).status).toBe(404);
 await s.send('/member/permissions/revoke',{permission:granted.permission.id});const retry=await(await s.send(path+'/grant',{digest:review.digest})).json();expect(retry.permission.revoked_at).toBe(now());expect(retry.permission.id).toBe(granted.permission.id);
 if(process.env.ATARASY_PERMISSION_REQUEST_FIXTURE_OUTPUT)writeFileSync(process.env.ATARASY_PERMISSION_REQUEST_FIXTURE_OUTPUT,JSON.stringify({environment:{name:s.c.environment,origin:s.c.origin},session:await(await s.send('/auth/session')).json(),review,granted,revoked:retry},null,2)+'\n',{flag:'wx',mode:0o600});
});
test('permission cancellation is terminal and expiry grants nothing',async()=>{
 const s=await setup(),review=await requestPermission(s),path='/member/permissions/requests/'+review.terms.requestID;
 const cancelled=await(await s.send(path+'/cancel',{digest:review.digest})).json();expect(cancelled.state).toBe('cancelled');expect(cancelled.permission).toBeNull();expect(await(await s.send(path+'/cancel',{digest:review.digest})).json()).toEqual(cancelled);expect((await s.send(path+'/grant',{digest:review.digest})).status).toBe(404);
 const laterReview=await requestPermission(s),laterPath='/member/permissions/requests/'+laterReview.terms.requestID,late=await openPostgresMemberHTTP(pool,s.identity,s.c,()=>now()+5000);
 expect((await(await late.fetch(s.request(laterPath,undefined,s.grant.token),{peer:'late'})).json()).state).toBe('expired');expect((await late.fetch(s.request(laterPath+'/grant',{digest:laterReview.digest},s.grant.token),{peer:'late'})).status).toBe(404);expect((await(await s.send('/member/permissions/list')).json()).permissions).toEqual([]);
});
test('permission requests refuse foreign sessions invalidated credentials and unsupported methods',async()=>{
 const s=await setup(),review=await requestPermission(s),other=await setup(),path='/member/permissions/requests/'+review.terms.requestID;
 const outsider=await s.unit.run(store=>{const r=memberRuntime(store,s.c,now);r.authority.provisionUnclaimedPrincipal('request-outsider',['merchant-1']);r.authority.registerCredential(other.input.credential,'request-outsider');r.login.provisionVerifiedPasskey(other.input.credential,coseOf(other.pair),1,other.user);r.authority.markCredentialProven(other.input.credential);r.authority.adoptHousehold('request-outsider',other.input.credential);return r.authority.createSessionAfterVerification(other.input.credential,now()+90000);});
 expect((await(await s.send('/member/permissions/requests',undefined,outsider.token)).json()).requests).toEqual([]);expect((await s.send(path,undefined,outsider.token)).status).toBe(404);expect((await s.send(path+'/grant',{digest:review.digest},outsider.token)).status).toBe(404);
 expect((await s.send(path,{})).status).toBe(405);expect((await s.send(path+'/grant')).status).toBe(405);expect((await s.send(path+'?household=other')).status).toBe(404);
 await s.unit.run(store=>memberRuntime(store,s.c,now).authority.revokeCredential(s.input.credential));expect((await s.send(path+'/grant',{digest:review.digest})).status).toBe(404);
});
test('permission grant and request outcome roll back together after database failure',async()=>{
 const s=await setup(),review=await requestPermission(s),path='/member/permissions/requests/'+review.terms.requestID,fn='fail_request_'+randomUUID().replaceAll('-','');
 await pool.query(`CREATE FUNCTION atarasy_member.${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.deployment = '${s.identity.id}' AND NEW.namespace = 'member_permission_requests' THEN RAISE EXCEPTION 'injected request failure'; END IF; RETURN NEW; END $$`);
 await pool.query(`CREATE TRIGGER ${fn} BEFORE INSERT OR UPDATE ON atarasy_member.engine_rows FOR EACH ROW EXECUTE FUNCTION atarasy_member.${fn}()`);
 try{expect((await s.send(path+'/grant',{digest:review.digest})).status).toBe(503);expect((await(await s.send('/member/permissions/list')).json()).permissions).toEqual([]);expect(await(await s.send(path)).json()).toEqual(review);}
 finally{await pool.query(`DROP TRIGGER ${fn} ON atarasy_member.engine_rows`);await pool.query(`DROP FUNCTION atarasy_member.${fn}()`);}
 expect((await s.send(path+'/grant',{digest:review.digest})).status).toBe(200);
});

const privateEnvelope=(byte:number)=>({profile:'atarasy.private-node-record.1',nonce:Buffer.alloc(12,byte).toString('base64url'),ciphertext:Buffer.alloc(48,byte).toString('base64url')});
test('private node retains only opaque versioned envelopes with compare-and-swap readback',async()=>{
 const s=await setup(),id=randomUUID(),path='/member/private-node/records/'+id,key=Buffer.alloc(32,37),clear=Buffer.from('Synthetic private purchase and note; never host plaintext.'),encrypt=(revision:number,byte:number)=>{const nonce=Buffer.alloc(12,byte),cipher=createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(Buffer.from(JSON.stringify(['atarasy.private-node-record.1',s.c.environment,s.c.origin,s.input.house,id,String(revision)])));const ciphertext=Buffer.concat([cipher.update(clear),cipher.final(),cipher.getAuthTag()]);return {profile:'atarasy.private-node-record.1',nonce:nonce.toString('base64url'),ciphertext:ciphertext.toString('base64url')};},first=encrypt(1,7),second=encrypt(2,8);
 const created=await s.send(path,{expectedRevision:0,envelope:first});expect(created.status).toBe(200);expect(created.headers.get('cache-control')).toBe('no-store');
 const one=await created.json();expect(one).toEqual({id,revision:1,updatedAt:now(),envelope:first});
 expect(await(await s.send(path)).json()).toEqual(one);expect((await(await s.send('/member/private-node/records')).json()).records).toEqual([one]);
 expect((await s.send(path,{expectedRevision:0,envelope:second})).status).toBe(409);expect(await(await s.send(path)).json()).toEqual(one);
 const updated=await(await s.send(path,{expectedRevision:1,envelope:second})).json();expect(updated.revision).toBe(2);expect(updated.envelope).toEqual(second);
 const stored=await pool.query('SELECT value FROM atarasy_member.engine_rows WHERE deployment=$1 AND namespace=$2',[s.identity.id,'private_node_records']);
 expect(stored.rows).toHaveLength(1);expect(stored.rows[0].value).not.toContain(s.input.house);expect(stored.rows[0].value).not.toContain(clear.toString());expect(stored.rows[0].value).not.toContain('token');expect(stored.rows[0].value).not.toContain('key');
 const restarted=await openPostgresMemberHTTP(pool,s.identity,s.c,now),reply=await restarted.fetch(s.request(path,undefined,s.grant.token),{peer:'private-restart'});expect(await reply.json()).toEqual(updated);
 if(process.env.ATARASY_PRIVATE_NODE_FIXTURE_OUTPUT)writeFileSync(process.env.ATARASY_PRIVATE_NODE_FIXTURE_OUTPUT,JSON.stringify({profile:'atarasy.private-node-fixture.1',scope:'Synthetic cross-language AES-256-GCM record; no bearer credential or live data.',environment:{name:s.c.environment,origin:s.c.origin},household:s.input.house,key:key.toString('base64url'),clear:clear.toString('base64url'),record:updated},null,2)+'\n',{flag:'wx',mode:0o600});
});
test('private node isolates households and rejects plaintext-shaped or malleable records',async()=>{
 const s=await setup(),other=await setup(),id=randomUUID(),path='/member/private-node/records/'+id,envelope=privateEnvelope(9);
 const outsider=await s.unit.run(store=>{const r=memberRuntime(store,s.c,now);r.authority.provisionUnclaimedPrincipal('private-outsider',[]);r.authority.registerCredential(other.input.credential,'private-outsider');r.login.provisionVerifiedPasskey(other.input.credential,coseOf(other.pair),1,other.user);r.authority.markCredentialProven(other.input.credential);r.authority.adoptHousehold('private-outsider',other.input.credential);return r.authority.createSessionAfterVerification(other.input.credential,now()+90000);});
 expect((await s.send(path,{expectedRevision:0,envelope})).status).toBe(200);expect((await s.send(path,undefined,outsider.token)).status).toBe(404);expect((await(await s.send('/member/private-node/records',undefined,outsider.token)).json()).records).toEqual([]);
 expect((await s.send(path,{expectedRevision:0,envelope},outsider.token)).status).toBe(200);expect((await s.send(path,undefined,outsider.token)).status).toBe(200);expect((await(await s.send('/member/private-node/records',undefined,outsider.token)).json()).records).toHaveLength(1);
 const invalid=[
  {expectedRevision:1,envelope:{...envelope,plaintext:'secret'}},
  {expectedRevision:1,envelope:{...envelope,nonce:Buffer.alloc(11).toString('base64url')}},
  {expectedRevision:1,envelope:{...envelope,ciphertext:Buffer.alloc(16).toString('base64url')}},
  {expectedRevision:1,envelope:{...envelope,ciphertext:Buffer.alloc(12_305).toString('base64url')}},
  {expectedRevision:1,envelope:{...envelope,profile:'other'}},
  {expectedRevision:1,envelope},
  {expectedRevision:1,envelope,household:s.input.house},
 ];
 // The sixth entry is valid and advances once; every other body is refused.
 for(const [index,value] of invalid.entries()){const response=await s.send(path,value);expect(response.status).toBe(index===5?200:400);}
 expect((await s.send(path+'?household=foreign')).status).toBe(404);expect((await s.send('/member/private-node/records',{})).status).toBe(405);
 await s.unit.run(store=>memberRuntime(store,s.c,now).authority.revokeCredential(s.input.credential));expect((await s.send(path)).status).toBe(404);
});
test('private node write rolls back on database failure and succeeds on exact retry',async()=>{
 const s=await setup(),id=randomUUID(),path='/member/private-node/records/'+id,fn='fail_private_'+randomUUID().replaceAll('-','');
 await pool.query(`CREATE FUNCTION atarasy_member.${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.deployment = '${s.identity.id}' AND NEW.namespace = 'private_node_records' THEN RAISE EXCEPTION 'injected private node failure'; END IF; RETURN NEW; END $$`);
 await pool.query(`CREATE TRIGGER ${fn} BEFORE INSERT OR UPDATE ON atarasy_member.engine_rows FOR EACH ROW EXECUTE FUNCTION atarasy_member.${fn}()`);
 try{expect((await s.send(path,{expectedRevision:0,envelope:privateEnvelope(10)})).status).toBe(503);expect((await(await s.send('/member/private-node/records')).json()).records).toEqual([]);}
 finally{await pool.query(`DROP TRIGGER ${fn} ON atarasy_member.engine_rows`);await pool.query(`DROP FUNCTION atarasy_member.${fn}()`);}
 expect((await s.send(path,{expectedRevision:0,envelope:privateEnvelope(10)})).status).toBe(200);
});

test('member host move imports equivalent records before a signed retirement ends old access',async()=>{
 const source=await setup(),targetOrigin='https://target.example',targetConfig={...source.c,origin:targetOrigin,rpID:'target.example'},targetIdentity:Identity={id:'http_'+randomUUID().replaceAll('-',''),environment:'test',origin:targetOrigin,epoch:1};
 ids.push(targetIdentity.id);await initialiseDeployment(pool,targetIdentity);
 const targetUnit=postgresStore(pool,targetIdentity),targetApp=await openPostgresMemberHTTP(pool,targetIdentity,targetConfig,now);
 const envelope={profile:'atarasy.private-node-record.1',nonce:randomBytes(12).toString('base64url'),ciphertext:randomBytes(48).toString('base64url')};
 expect((await source.send('/member/private-node/records/55555555-5555-4555-8555-555555555555',{expectedRevision:0,envelope})).status).toBe(200);
 const {PermissionLedger}=await import('../../engine/src/hub/permissions.ts');
 await source.unit.run(store=>{const ledger=new PermissionLedger(store),action=ledger.openAction({household:source.input.house,describes:'Portable permission',expiresAt:now()+60000});ledger.grant({household:source.input.house,grantee:'portable-reader',scope:['duplicate_check'],purpose:'Portable purpose',expires_at:now()+50000,asked_from:action.id,now:now()});});
 const recoverer=(await setup()).input.house,recoveryPublicKey=Buffer.concat([Buffer.from([4]),randomBytes(64)]).toString('base64url'),recoveryKeyDigest=createHash('sha256').update(JSON.stringify(['atarasy.member-recovery-key.1',recoveryPublicKey])).digest('base64url'),recoveryID=randomUUID(),noticeID=randomUUID(),recoveryAt=now()-10,recoveryMaterial={keyDigest:randomBytes(32).toString('base64url'),hostShare:randomBytes(64).toString('base64url'),recovererPacket:randomBytes(128).toString('base64url'),noticeChannel:'anc1_'+randomBytes(32).toString('base64url')};
 await source.unit.run(store=>{
  store.map('member_recovery_keys').set(recoverer,{household:recoverer,publicKey:recoveryPublicKey,updatedAt:recoveryAt});
  store.map('member_recovery_configurations').set(source.input.house,{owner:source.input.house,recoverer,recovererKeyDigest:recoveryKeyDigest,...recoveryMaterial,epoch:1,createdAt:recoveryAt,updatedAt:recoveryAt});
  store.map('member_recovery_requests').set(recoveryID,{id:recoveryID,owner:source.input.house,recoverer,epoch:1,requesterPublicKey:Buffer.concat([Buffer.from([4]),randomBytes(64)]).toString('base64url'),...recoveryMaterial,state:'completed',release:randomBytes(128).toString('base64url'),noticeID,noticeReceipt:'portable-notice-receipt',createdAt:recoveryAt,updatedAt:recoveryAt+1});
  store.map('member_recovery_logs').set(noticeID,{id:noticeID,owner:source.input.house,recovery:recoveryID,recoverer,state:'completed',occurredAt:recoveryAt,deliveredAt:recoveryAt+1,receipt:'portable-notice-receipt'});
 });
 const dependencyNames=['identities','root_endorsed','configs','disclosures','registry_entries','registry_keys'];
 const dependencies=await source.unit.run(store=>dependencyNames.map(namespace=>[namespace,[...store.map<unknown>(namespace)].map(([key,value])=>[key,structuredClone(value)] as const)] as const));
 await targetUnit.run(store=>{for(const [namespace,entries]of dependencies){const map=store.map(namespace);for(const [key,value]of entries)map.set(key,value);}});
 const targetGrant=await targetUnit.run(store=>{const r=memberRuntime(store,targetConfig,now);r.authority.provisionUnclaimedPrincipal('moved-member',['merchant-1']);r.authority.registerCredential(source.input.credential,'moved-member');r.login.provisionVerifiedPasskey(source.input.credential,coseOf(source.pair),1,source.user);r.authority.markCredentialProven(source.input.credential);expect(r.authority.adoptHousehold('moved-member',source.input.credential)).toBe(source.input.house);return r.authority.createSessionAfterVerification(source.input.credential,now()+90000);});
 const targetRequest=(path:string,body?:unknown)=>new Request(targetOrigin+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',authorization:'Bearer '+targetGrant.token},...(body===undefined?{}:{body:JSON.stringify(body)})}),targetSend=(path:string,body?:unknown)=>targetApp.fetch(targetRequest(path,body),{peer:'move-target'});
 const statementReview=await(await source.send('/member/statements/prepare',{offer:source.input.statement.offer,disputed:[]})).json();
 const statementAssertion=loginResponse(source.pair,source.input.credential,source.user,statementReview.publicKey.challenge,50);
 expect((await source.send('/member/operations/'+statementReview.operationID+'/submit',{assertion:statementAssertion})).status).toBe(200);
 const preparedResponse=await source.send('/member/host-move/export',{targetOrigin});expect(preparedResponse.status).toBe(201);const prepared=await preparedResponse.json();
 expect(prepared).toMatchObject({profile:'atarasy.member-host-export.1',household:source.input.house,sourceOrigin:source.c.origin,targetOrigin});
 expect(JSON.stringify(prepared)).not.toContain(source.grant.token);
 const archive=JSON.parse(Buffer.from(prepared.archive,'base64url').toString('utf8'));
 const movedPrivate=archive.privateRecords.map((row:any)=>({...row,envelope:{profile:'atarasy.private-node-record.1',nonce:randomBytes(12).toString('base64url'),ciphertext:randomBytes(48).toString('base64url')} }));
 const damaged=prepared.archive.slice(0,-1)+(prepared.archive.endsWith('A')?'B':'A');
 expect((await targetSend('/member/host-move/import',{archive:damaged,digest:prepared.digest,privateRecords:movedPrivate})).status).toBe(400);
 const mismatchedPrivate=movedPrivate.map((row:any,index:number)=>index===0?{...row,id:randomUUID()}:row);
 expect((await targetSend('/member/host-move/import',{archive:prepared.archive,digest:prepared.digest,privateRecords:mismatchedPrivate})).status).toBe(400);
 expect((await source.send('/auth/session')).status).toBe(200);expect((await targetSend('/member/private-node/records')).status).toBe(200);
 const importedResponse=await targetSend('/member/host-move/import',{archive:prepared.archive,digest:prepared.digest,privateRecords:movedPrivate});expect(importedResponse.status).toBe(201);const receipt=await importedResponse.json();
 expect(archive.node.offers).toHaveLength(1);expect(await targetUnit.run(store=>[...store.map('offers').values()])).toHaveLength(1);
 expect(receipt).toMatchObject({profile:'atarasy.member-host-import-receipt.1',move:prepared.id,household:source.input.house,sourceOrigin:source.c.origin,targetOrigin,archiveDigest:prepared.digest,privateRecords:movedPrivate.length});
 expect(await(await targetSend('/member/host-move/imports/'+prepared.digest)).json()).toEqual(receipt);
 expect(await(await targetSend('/member/host-move/import',{archive:prepared.archive,digest:prepared.digest,privateRecords:movedPrivate})).json()).toEqual(receipt);
 const importProofReview=await(await targetSend('/member/host-move/imports/'+prepared.digest+'/prepare',{})).json(),targetAssertion=loginResponseAt(source.pair,source.input.credential,source.user,importProofReview.publicKey.challenge,2,targetOrigin,targetConfig.rpID);
 const attestation=await(await targetSend('/member/host-move/imports/'+prepared.digest+'/attest',{preparation:importProofReview.id,assertion:targetAssertion})).json();expect(attestation).toMatchObject({profile:'atarasy.member-host-import-attestation.1',receipt,proof:{credential:source.input.credential}});
 const restartedTarget=await openPostgresMemberHTTP(pool,targetIdentity,targetConfig,now),restartSend=(path:string)=>restartedTarget.fetch(targetRequest(path),{peer:'move-target-restart'});
 expect(await(await restartSend('/member/host-move/imports/'+prepared.digest)).json()).toEqual(receipt);expect((await restartSend('/member/private-node/records')).status).toBe(200);
 const sourcePermissions=await(await source.send('/member/permissions/list')).json(),targetPermissions=await(await targetSend('/member/permissions/list')).json();expect(targetPermissions.permissions).toEqual(sourcePermissions.permissions);
 for(const path of ['/member/recovery/configuration','/member/recovery/requests','/member/recovery/log'])expect(await(await targetSend(path)).json()).toEqual(await(await source.send(path)).json());
 const targetRecords=await(await targetSend('/member/private-node/records')).json();expect(targetRecords.records).toEqual(movedPrivate);
 const sourceOffers=await(await source.send('/offers?household='+encodeURIComponent(source.input.house)+'&presenter=merchant-1')).json(),targetOffers=await(await targetSend('/offers?household='+encodeURIComponent(source.input.house)+'&presenter=merchant-1')).json();expect(targetOffers).toEqual(sourceOffers);
 expect((await source.send('/member/host-move/'+prepared.id+'/retirement/prepare',{attestation:{...attestation,receipt:{...receipt,importedAt:receipt.importedAt+1}}})).status).toBe(404);
 const retirementReview=await(await source.send('/member/host-move/'+prepared.id+'/retirement/prepare',{attestation})).json();
 expect((await source.send('/member/host-move/'+prepared.id+'/retirement/retire',{preparation:retirementReview.id,attestation:{...attestation,receipt:{...receipt,importedAt:receipt.importedAt+1}},assertion:{}})).status).toBe(404);expect((await source.send('/auth/session')).status).toBe(200);
 const assertion=loginResponse(source.pair,source.input.credential,source.user,retirementReview.publicKey.challenge,60);
 const retired=await source.send('/member/host-move/'+prepared.id+'/retirement/retire',{preparation:retirementReview.id,attestation,assertion});expect(retired.status).toBe(200);expect(await retired.json()).toMatchObject({profile:'atarasy.member-host-retirement.1',move:prepared.id,targetOrigin});
 expect((await source.send('/auth/session')).status).toBe(401);expect((await targetSend('/auth/session')).status).toBe(200);expect((await targetSend('/member/private-node/records')).status).toBe(200);
});

test('host move refuses while recovery is unresolved and keeps source authority',async()=>{
 const source=await setup(),id=randomUUID(),recoverer=(await setup()).input.house;
 await source.unit.run(store=>{store.map('member_recovery_requests').set(id,{id,owner:source.input.house,recoverer,epoch:1,requesterPublicKey:Buffer.concat([Buffer.from([4]),randomBytes(64)]).toString('base64url'),hostShare:randomBytes(64).toString('base64url'),recovererPacket:randomBytes(128).toString('base64url'),keyDigest:randomBytes(32).toString('base64url'),noticeChannel:'anc1_'+randomBytes(32).toString('base64url'),state:'pending',release:null,noticeID:null,noticeReceipt:null,createdAt:now(),updatedAt:now()});});
 const refused=await source.send('/member/host-move/export',{targetOrigin:'https://target.example'});expect(refused.status).toBe(409);expect(await refused.json()).toEqual({error:'recovery_move_pending'});expect((await source.send('/auth/session')).status).toBe(200);
});
test('host move rolls back a target import that would leave an active offer behind',async()=>{
 const source=await setup(),targetOrigin='https://target.example',targetConfig={...source.c,origin:targetOrigin,rpID:'target.example'},targetIdentity:Identity={id:'http_'+randomUUID().replaceAll('-',''),environment:'test',origin:targetOrigin,epoch:1};ids.push(targetIdentity.id);await initialiseDeployment(pool,targetIdentity);
 const targetUnit=postgresStore(pool,targetIdentity),dependencyNames=['identities','root_endorsed','configs','disclosures','registry_entries','registry_keys'],dependencies=await source.unit.run(store=>dependencyNames.map(namespace=>[namespace,[...store.map<unknown>(namespace)].map(([key,value])=>[key,structuredClone(value)] as const)] as const));
 await targetUnit.run(store=>{for(const [namespace,entries]of dependencies){const map=store.map(namespace);for(const [key,value]of entries)map.set(key,value);}});
 const targetGrant=await targetUnit.run(store=>{const r=memberRuntime(store,targetConfig,now);r.authority.provisionUnclaimedPrincipal('moving-active-member',['merchant-1']);r.authority.registerCredential(source.input.credential,'moving-active-member');r.login.provisionVerifiedPasskey(source.input.credential,coseOf(source.pair),1,source.user);r.authority.markCredentialProven(source.input.credential);r.authority.adoptHousehold('moving-active-member',source.input.credential);return r.authority.createSessionAfterVerification(source.input.credential,now()+90000);}),targetApp=await openPostgresMemberHTTP(pool,targetIdentity,targetConfig,now);
 const prepared=await(await source.send('/member/host-move/export',{targetOrigin})).json(),reply=await targetApp.fetch(new Request(targetOrigin+'/member/host-move/import',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+targetGrant.token},body:JSON.stringify({archive:prepared.archive,digest:prepared.digest,privateRecords:[]})}),{peer:'active-move-target'});
 expect(reply.status).toBe(409);expect(await reply.json()).toEqual({error:'host_move_import_incomplete'});expect((await source.send('/auth/session')).status).toBe(200);
 expect(await targetUnit.run(store=>({offers:store.map('offers').size,imports:store.map('member_host_imports').size}))).toEqual({offers:0,imports:0});
});

test('refresh subscriptions emit only a generic durable wake and stop after access revocation',async()=>{
 const s=await setup(),token='ab'.repeat(32);
 expect(await(await s.send('/member/refresh')).json()).toEqual({profile:'atarasy.member-refresh-subscription.1',active:false,apnsEnvironment:null,updatedAt:null});
 expect((await s.send('/member/refresh/subscription',{token:'not-an-apns-token',apnsEnvironment:'sandbox'})).status).toBe(400);
 const registered=await s.send('/member/refresh/subscription',{token,apnsEnvironment:'sandbox'});expect(registered.status).toBe(200);expect(await registered.json()).toMatchObject({profile:'atarasy.member-refresh-subscription.1',active:true,apnsEnvironment:'sandbox'});
 expect((await s.app.deliverRefreshHints({async deliver(){throw new Error('unchanged source must not wake');}})).delivered).toBe(0);
 await s.unit.run(store=>{const offers=store.map<any>('offers'),offer=offers.get(s.input.statement.offer)!;offers.set(offer.id,{...offer,reminders_sent:offer.reminders_sent+1});});
 let attempts=0;try{await s.app.deliverRefreshHints({async deliver(job){attempts++;expect(job.token).toBe(token);expect(job.apnsEnvironment).toBe('sandbox');expect(job.payload).toEqual({aps:{'content-available':1},atarasy:{profile:'atarasy.member-refresh-hint.1'}});expect(JSON.stringify(job)).not.toContain(s.input.house);expect(JSON.stringify(job)).not.toContain(s.input.statement.offer);expect(JSON.stringify(job)).not.toContain('merchant-1');throw new Error('apns down');}});}catch(error){expect((error as Error).message).toBe('apns down');}
 expect(attempts).toBe(1);
 let firstID='';const delivered=await s.app.deliverRefreshHints({async deliver(job){firstID=job.id;return {receipt:'apns-'+job.id};}});expect(delivered.delivered).toBe(1);expect(firstID).toMatch(/^[a-f0-9-]{36}$/);
 expect((await s.app.deliverRefreshHints({async deliver(){throw new Error('acknowledged hint repeated');}})).delivered).toBe(0);
 expect((await s.send('/auth/logout',{})).status).toBe(204);
 await s.unit.run(store=>{const offers=store.map<any>('offers'),offer=offers.get(s.input.statement.offer)!;offers.set(offer.id,{...offer,reminders_sent:offer.reminders_sent+1});});
 expect((await s.app.deliverRefreshHints({async deliver(){throw new Error('logged-out device received a wake');}})).delivered).toBe(0);
 expect((await s.send('/member/refresh')).status).toBe(404);
});

test('Android refresh uses an FCM data-only durable wake and stops after logout',async()=>{
 const s=await setup(),installation='A'.repeat(22);
 expect(await(await s.send('/member/android-refresh')).json()).toEqual({profile:'atarasy.member-android-refresh-subscription.1',active:false,updatedAt:null});
 expect((await s.send('/member/android-refresh/subscription',{installation:'bad installation'})).status).toBe(400);
 expect(await(await s.send('/member/android-refresh/subscription',{installation})).json()).toMatchObject({profile:'atarasy.member-android-refresh-subscription.1',active:true});
 expect((await s.app.deliverAndroidRefreshHints({async deliver(){throw new Error('unchanged source must not wake');}})).delivered).toBe(0);
 await s.unit.run(store=>{const offers=store.map<any>('offers'),offer=offers.get(s.input.statement.offer)!;offers.set(offer.id,{...offer,reminders_sent:offer.reminders_sent+1});});
 let attempts=0;try{await s.app.deliverAndroidRefreshHints({async deliver(job){attempts++;expect(job.fid).toBe(installation);expect(job.payload).toEqual({data:{profile:'atarasy.member-refresh-hint.1'}});expect(JSON.stringify(job)).not.toContain(s.input.house);expect(JSON.stringify(job)).not.toContain(s.input.statement.offer);expect(JSON.stringify(job)).not.toContain('merchant-1');throw new Error('fcm down');}});}catch(error){expect((error as Error).message).toBe('fcm down');}
 expect(attempts).toBe(1);let firstID='';expect((await s.app.deliverAndroidRefreshHints({async deliver(job){firstID=job.id;return {receipt:'fcm-'+job.id};}})).delivered).toBe(1);expect(firstID).toMatch(/^[a-f0-9-]{36}$/);
 expect((await s.app.deliverAndroidRefreshHints({async deliver(){throw new Error('acknowledged hint repeated');}})).delivered).toBe(0);
 expect((await s.send('/auth/logout',{})).status).toBe(204);await s.unit.run(store=>{const offers=store.map<any>('offers'),offer=offers.get(s.input.statement.offer)!;offers.set(offer.id,{...offer,reminders_sent:offer.reminders_sent+1});});
 expect((await s.app.deliverAndroidRefreshHints({async deliver(){throw new Error('logged-out device received a wake');}})).delivered).toBe(0);expect((await s.send('/member/android-refresh')).status).toBe(404);
});

test('lost-device recovery releases no share until a recoverer signs and an independent notice is delivered',async()=>{
 const s=await setup(),recovererDevice=syntheticAuthenticator();
 await s.unit.run(store=>memberRuntime(store,s.c,now).authority.provisionUnclaimedPrincipal('recovery-participant',[]));
 const invitation=await s.unit.run(store=>memberRuntime(store,s.c,now).enrollment.issueInvitation('recovery-participant'));
 const enrollment=await(await s.send('/auth/enrollment/options',{invitation:invitation.token})).json();
 expect((await s.send('/auth/enrollment/verify',{id:enrollment.id,response:recovererDevice.register(enrollment.publicKey.challenge,s.c.origin,s.c.rpID)})).status).toBe(201);
 const login=await(await s.send('/auth/login/options',{})).json(),recovererUser=enrollment.publicKey.user.id;
 const signedIn=await s.send('/auth/login/verify',{id:login.id,response:recovererDevice.authenticate(login.publicKey.challenge,s.c.origin,s.c.rpID,recovererUser,1)});expect(signedIn.status).toBe(200);
 const recovererToken=(await signedIn.json()).token as string,recoverer=await s.unit.run(store=>memberRuntime(store,s.c,now).authority.adoptHousehold('recovery-participant',recovererDevice.id));
 const recoveryPublicKey=Buffer.concat([Buffer.from([4]),randomBytes(64)]).toString('base64url');
 const preparedKey=await(await s.send('/member/recovery/key/prepare',{publicKey:recoveryPublicKey},recovererToken)).json();
 const keyAssertion=recovererDevice.authenticate(preparedKey.publicKey.challenge,s.c.origin,s.c.rpID,recovererUser,2);
 const registered=await(await s.send('/member/recovery/key/register',{preparation:preparedKey.id,publicKey:recoveryPublicKey,assertion:keyAssertion},recovererToken)).json();expect(registered).toMatchObject({household:recoverer,publicKey:recoveryPublicKey});
 const participant=await(await s.send('/member/recovery/participant',{household:recoverer})).json();expect(participant.publicKey).toBe(recoveryPublicKey);
 const configuration={epoch:1,recoverer,keyDigest:randomBytes(32).toString('base64url'),hostShare:randomBytes(64).toString('base64url'),recovererPacket:randomBytes(128).toString('base64url'),noticeChannel:'anc1_'+randomBytes(32).toString('base64url')};
 const preparedConfiguration=await(await s.send('/member/recovery/configuration/prepare',configuration)).json();
 const ownerAssertion=loginResponse(s.pair,s.input.credential,s.user,preparedConfiguration.publicKey.challenge,20);
 const configured=await(await s.send('/member/recovery/configuration/submit',{preparation:preparedConfiguration.id,configuration,assertion:ownerAssertion})).json();expect(configured).toMatchObject({owner:s.input.house,recoverer,epoch:1,configured:true});
 const requesterPublicKey=Buffer.concat([Buffer.from([4]),randomBytes(64)]).toString('base64url');
 const created=await(await s.send('/member/recovery/requests',{requesterPublicKey})).json();expect(created).toMatchObject({owner:s.input.house,recoverer,state:'pending',hostShare:null,release:null});
 expect((await s.app.deliverRecoveryNotices({async deliver(){throw new Error('must not deliver');}})).delivered).toBe(0);
 expect((await s.send('/member/recovery/requests/'+created.id+'/prepare',{release:randomBytes(128).toString('base64url')})).status).toBe(404);
 const recovererList=await(await s.send('/member/recovery/requests',undefined,recovererToken)).json();expect(recovererList.requests[0]).toMatchObject({id:created.id,recovererPacket:configuration.recovererPacket,hostShare:null});
 const release=randomBytes(128).toString('base64url'),preparedApproval=await(await s.send('/member/recovery/requests/'+created.id+'/prepare',{release},recovererToken)).json();
 const approvalAssertion=recovererDevice.authenticate(preparedApproval.publicKey.challenge,s.c.origin,s.c.rpID,recovererUser,3);
 const approved=await(await s.send('/member/recovery/requests/'+created.id+'/approve',{preparation:preparedApproval.id,release,assertion:approvalAssertion},recovererToken)).json();expect(approved).toMatchObject({state:'approved',hostShare:null});
 const beforeNotice=await(await s.send('/member/recovery/requests/'+created.id)).json();expect(beforeNotice).toMatchObject({state:'approved',hostShare:null,release:null,keyDigest:null});
 const pendingLog=await(await s.send('/member/recovery/log')).json();expect(pendingLog.events).toHaveLength(1);expect(pendingLog.events[0]).toMatchObject({recovery:created.id,state:'notice_pending',deliveredAt:null});
 let attempted=0;try{await s.app.deliverRecoveryNotices({async deliver(job){attempted++;expect(job.channel).toBe(configuration.noticeChannel);expect(job.notice).toMatchObject({owner:s.input.house,recovery:created.id});throw new Error('independent channel down');}});}catch(error){expect((error as Error).message).toBe('independent channel down');}
 expect(attempted).toBe(1);expect((await(await s.send('/member/recovery/requests/'+created.id)).json()).hostShare).toBeNull();
 const delivered=await s.app.deliverRecoveryNotices({async deliver(job){return {receipt:'notice-receipt-'+job.notice.id};}});expect(delivered.delivered).toBe(1);
 const completed=await(await s.send('/member/recovery/requests/'+created.id)).json();expect(completed).toMatchObject({state:'completed',hostShare:configuration.hostShare,release,keyDigest:configuration.keyDigest});
 const finalLog=await(await s.send('/member/recovery/log')).json();expect(finalLog.events[0]).toMatchObject({state:'completed',receipt:'notice-receipt-'+finalLog.events[0].id});
 if(process.env.ATARASY_RECOVERY_FIXTURE_OUTPUT)writeFileSync(process.env.ATARASY_RECOVERY_FIXTURE_OUTPUT,JSON.stringify({profile:'atarasy.member-recovery-fixture.1',scope:'Synthetic PostgreSQL recovery ceremony; no bearer token, private key or live notice destination.',environment:{name:s.c.environment,origin:s.c.origin},ownerSession:await(await s.send('/auth/session')).json(),recovererSession:await(await s.send('/auth/session',undefined,recovererToken)).json(),recoveryPublicKey,registered,participant,configuration,preparedConfiguration,configured,created,recovererList,preparedApproval,approved,pendingLog,completed,finalLog},null,2)+'\n',{flag:'wx',mode:0o600});
 const recovererAfter=await(await s.send('/member/recovery/requests/'+created.id,undefined,recovererToken)).json();expect(recovererAfter.hostShare).toBeNull();expect(recovererAfter.keyDigest).toBeNull();
 expect((await s.app.deliverRecoveryNotices({async deliver(){throw new Error('completed notice repeated');}})).delivered).toBe(0);
 const secondRequest=await(await s.send('/member/recovery/requests',{requesterPublicKey:Buffer.concat([Buffer.from([4]),randomBytes(64)]).toString('base64url')})).json();expect(secondRequest.state).toBe('pending');
 const nextConfiguration={...configuration,epoch:2,keyDigest:randomBytes(32).toString('base64url'),hostShare:randomBytes(64).toString('base64url'),recovererPacket:randomBytes(128).toString('base64url')};
 const nextPrepared=await(await s.send('/member/recovery/configuration/prepare',nextConfiguration)).json(),nextAssertion=loginResponse(s.pair,s.input.credential,s.user,nextPrepared.publicKey.challenge,21);
 expect((await s.send('/member/recovery/configuration/submit',{preparation:nextPrepared.id,configuration:nextConfiguration,assertion:nextAssertion})).status).toBe(200);
 expect(await(await s.send('/member/recovery/requests/'+created.id)).json()).toEqual(completed);
 expect(await(await s.send('/member/recovery/requests/'+secondRequest.id)).json()).toMatchObject({state:'cancelled',hostShare:null,release:null});
 const restarted=await openPostgresMemberHTTP(pool,s.identity,s.c,now),afterRestart=await restarted.fetch(s.request('/member/recovery/requests/'+created.id,undefined,s.grant.token),{peer:'recovery-restart'});expect(await afterRestart.json()).toEqual(completed);
});

test('recovery rejects host-only foreign stale and malformed attempts without replacing the configured policy',async()=>{
 const s=await setup(),other=await setup(),key=Buffer.concat([Buffer.from([4]),randomBytes(64)]).toString('base64url');
 const absent={epoch:1,recoverer:other.input.house,keyDigest:randomBytes(32).toString('base64url'),hostShare:randomBytes(64).toString('base64url'),recovererPacket:randomBytes(128).toString('base64url'),noticeChannel:'anc1_'+randomBytes(32).toString('base64url')};
 expect((await s.send('/member/recovery/configuration/prepare',absent)).status).toBe(404);
 for(const [path,body,status] of [['/member/recovery/key/prepare',{publicKey:key+'x'},400],['/member/recovery/requests',{requesterPublicKey:key},404],['/member/recovery/configuration/submit',{configuration:absent,assertion:{}},400]] as const)expect((await s.send(path,body)).status).toBe(status);
 expect(await(await s.send('/member/recovery/configuration')).json()).toEqual({profile:'atarasy.member-recovery-configuration.1',owner:s.input.house,configured:false,recoverer:null,recovererKeyDigest:null,keyDigest:null,epoch:null,createdAt:null,updatedAt:null});
 expect((await other.send('/member/recovery/participant',{household:s.input.house})).status).toBe(404);
});
test('question 70: a household reads its own settled offer\'s corrections receipt, and an unsettled offer, an unknown offer and a foreign household all refuse',async()=>{
 const s=await setup(),offer=s.input.statement.offer,path='/offers/'+offer+'/corrections';
 // Not yet settled: the engine's own 404 passes through the gate.
 expect((await s.send(path)).status).toBe(404);
 expect((await s.send('/offers/does-not-exist/corrections')).status).toBe(404);
 const submit=await (await s.send('/member/statements/prepare',{offer,disputed:[]})).json();
 expect((await s.send('/member/operations/'+submit.operationID+'/submit',{assertion:loginResponse(s.pair,s.input.credential,s.user,submit.publicKey.challenge,2)})).status).toBe(200);
 const {correction,settlement}=await s.unit.run(store=>{
  const r=memberRuntime(store,s.c,now),settlement=r.engine.settlement(offer)!;
  const fields={id:'r-1',offer,merchant:'maker-a',amount:500,kind:'refund' as const,note:'damaged in transit',corrected_at:settlement.settled_at+1};
  const signed={...fields,signature:sign(null,canonicalCorrection(fields),MERCHANT_PAIR.privateKey).toString('base64')};
  const {correction}=r.engine.appendCorrection(signed,550);
  return {correction,settlement};
 });
 const own=await s.send(path);expect(own.status).toBe(200);
 expect(await own.json()).toEqual({offer,original:{charged:settlement.charged,carriage:550},corrections:[correction],net:settlement.charged+550-500});
 // A scoped session for another household in the same deployment cannot read it.
 const outsider=await setup();
 const foreign=await s.unit.run(store=>{const r=memberRuntime(store,s.c,now);
  r.authority.provisionUnclaimedPrincipal('outsider',['merchant-1']);
  r.authority.registerCredential(outsider.input.credential,'outsider');
  r.login.provisionVerifiedPasskey(outsider.input.credential,coseOf(outsider.pair),1,outsider.user);
  r.authority.markCredentialProven(outsider.input.credential);r.authority.adoptHousehold('outsider',outsider.input.credential);
  return r.authority.createSessionAfterVerification(outsider.input.credential,now()+90000);
 });
 expect((await s.send(path,undefined,foreign.token)).status).toBe(404);
});
async function enrollFreshHousehold(s:Awaited<ReturnType<typeof setup>>,principal:string){
 const key=syntheticAuthenticator();
 await s.unit.run(store=>{const r=memberRuntime(store,s.c,now);r.authority.provisionUnclaimedPrincipal(principal,[]);});
 const invitation=await s.unit.run(store=>memberRuntime(store,s.c,now).enrollment.issueInvitation(principal));
 const enrolled=await (await s.send('/auth/enrollment/options',{invitation:invitation.token})).json();
 const registered=await s.send('/auth/enrollment/verify',{id:enrolled.id,response:key.register(enrolled.publicKey.challenge,s.c.origin,s.c.rpID)});
 if(registered.status!==201)throw new Error('fixture enrolment failed: '+registered.status);
 const loginFlow=await (await s.send('/auth/login/options',{})).json(),user=enrolled.publicKey.user.id;
 const signedIn=await s.send('/auth/login/verify',{id:loginFlow.id,response:key.authenticate(loginFlow.publicKey.challenge,s.c.origin,s.c.rpID,user,1)});
 if(signedIn.status!==200)throw new Error('fixture login failed: '+signedIn.status);
 const token=(await signedIn.json()).token as string;
 const household=await s.unit.run(store=>{
  const r=memberRuntime(store,s.c,now),name=r.authority.adoptHousehold(principal,key.id),pub=r.login.verifiedPublicKey(key.id)!;
  r.engine.registerIdentity(name,createPublicKey({key:credentialSPKI(pub),format:'der',type:'spki'}).export({type:'spki',format:'pem'}).toString());
  return name;
 });
 return {key,user,token,household};
}
test('§14.3: a household with nothing pending can leave, its old session and passkey stop working, and an unrelated household on the host is untouched',async()=>{
 const s=await setup();
 const untouchedBefore=await s.unit.run(store=>({
  principal:store.map<any>('member_principals').get('member'),
  offer:store.map<any>('offers').get(s.input.statement.offer),
  identity:store.map<any>('identities').get(s.input.house),
 }));
 const a=await enrollFreshHousehold(s,'leaving-member');
 expect(await (await s.send('/member/account/leave',undefined,a.token)).json()).toEqual({profile:'atarasy.member-leave-status.1',household:a.household,blockers:[]});
 const review=await (await s.send('/member/account/leave/prepare',{},a.token)).json();
 expect(review).toMatchObject({profile:'atarasy.member-leave.1',household:a.household,origin:s.c.origin,rpID:s.c.rpID});
 const assertion=a.key.authenticate(review.publicKey.challenge,s.c.origin,s.c.rpID,a.user,2);
 const submitted=await s.send('/member/account/leave/submit',{preparation:review.id,assertion},a.token);
 expect(submitted.status).toBe(200);
 const left=await submitted.json();
 expect(left).toMatchObject({profile:'atarasy.member-left.1',household:a.household});
 expect(left.deleted).toMatchObject({principals:1,credentials:1,sessions:1,passkeys:1,identities:1});
 expect((await s.send('/auth/session',undefined,a.token)).status).toBe(401);
 const relogin=await (await s.send('/auth/login/options',{})).json();
 const retry=await s.send('/auth/login/verify',{id:relogin.id,response:a.key.authenticate(relogin.publicKey.challenge,s.c.origin,s.c.rpID,a.user,3)});
 expect(retry.status).not.toBe(200);
 const leftBehind=await s.unit.run(store=>({
  principal:store.map<any>('member_principals').get('leaving-member'),
  credential:store.map<any>('member_credentials').get(a.key.id),
  passkey:store.map<any>('member_passkeys').get(a.key.id),
  identity:store.map<any>('identities').get(a.household),
 }));
 expect(leftBehind).toEqual({principal:undefined,credential:undefined,passkey:undefined,identity:undefined});
 const untouchedAfter=await s.unit.run(store=>({
  principal:store.map<any>('member_principals').get('member'),
  offer:store.map<any>('offers').get(s.input.statement.offer),
  identity:store.map<any>('identities').get(s.input.house),
 }));
 expect(untouchedAfter).toEqual(untouchedBefore);
});
test('§14.3: a household with an offer in progress cannot leave, and nothing changes',async()=>{
 const s=await setup();
 const status=await (await s.send('/member/account/leave',undefined,s.grant.token)).json();
 expect(status.household).toBe(s.input.house);
 expect(status.blockers.some((b:{kind:string})=>b.kind==='offer_in_progress')).toBe(true);
 const before=await s.unit.run(store=>store.map<any>('member_principals').get('member'));
 const refused=await s.send('/member/account/leave/prepare',{},s.grant.token);
 expect(refused.status).toBe(409);
 const body=await refused.json();
 expect(body.error).toBe('leave_blocked');
 expect(Array.isArray(body.blockers)).toBe(true);
 expect(body.blockers.length).toBeGreaterThan(0);
 const after=await s.unit.run(store=>store.map<any>('member_principals').get('member'));
 expect(after).toEqual(before);
});
test('§14.3: a session alone cannot delete an account, whether the preparation is unknown, the assertion is over a different review, or the session is another household\'s',async()=>{
 const s=await setup();
 const a=await enrollFreshHousehold(s,'leaver-a'),b=await enrollFreshHousehold(s,'leaver-b');
 const snapshotA=()=>s.unit.run(store=>store.map<any>('member_principals').get('leaver-a'));
 const beforeA=await snapshotA();
 const unknown=await s.send('/member/account/leave/submit',{preparation:randomUUID(),assertion:{}},a.token);
 expect(unknown.status).not.toBe(200);
 expect(await snapshotA()).toEqual(beforeA);
 const reviewOne=await (await s.send('/member/account/leave/prepare',{},a.token)).json();
 const reviewTwo=await (await s.send('/member/account/leave/prepare',{},a.token)).json();
 const mismatched=await s.send('/member/account/leave/submit',{preparation:reviewOne.id,assertion:a.key.authenticate(reviewTwo.publicKey.challenge,s.c.origin,s.c.rpID,a.user,2)},a.token);
 expect(mismatched.status).not.toBe(200);
 expect(await snapshotA()).toEqual(beforeA);
 const crossHousehold=await s.send('/member/account/leave/submit',{preparation:reviewTwo.id,assertion:{}},b.token);
 expect(crossHousehold.status).not.toBe(200);
 expect(await snapshotA()).toEqual(beforeA);
});
test('§14.3: a blocker that appears after prepare refuses the submission and deletes nothing',async()=>{
 const s=await setup();
 const c=await enrollFreshHousehold(s,'leaver-c');
 const review=await (await s.send('/member/account/leave/prepare',{},c.token)).json();
 await s.unit.run(store=>{
  store.map<any>('member_permission_requests').set('late-request',{terms:{profile:'atarasy.permission-review.1',requestID:'late-request',household:c.household,action:'Check whether you already have it',requester:{id:'merchant-1',name:'Merchant One'},purpose:'Avoid a duplicate gift',fields:[{id:'duplicate_check',label:'Whether you already have a product'}],createdAt:now(),reviewExpiresAt:now()+10000,accessExpiresAt:now()+20000},digest:'unchecked-in-this-fixture',actionID:'late-action',product:'tea-a',privateDigest:'unchecked-in-this-fixture',state:'pending',permissionID:null,decidedAt:null});
 });
 const assertion=c.key.authenticate(review.publicKey.challenge,s.c.origin,s.c.rpID,c.user,2);
 const refused=await s.send('/member/account/leave/submit',{preparation:review.id,assertion},c.token);
 expect(refused.status).toBe(409);
 const body=await refused.json();
 expect(body.error).toBe('leave_blocked');
 expect(body.blockers.some((b:{kind:string})=>b.kind==='permission_request_pending')).toBe(true);
 const principal=await s.unit.run(store=>store.map<any>('member_principals').get('leaver-c'));
 expect(principal).toBeDefined();
});
test('§14.3: an unexpired uncommitted operation, a pending mandate change and a pending recovery request each block leaving on their own',async()=>{
 const s=await setup();
 const d=await enrollFreshHousehold(s,'leaver-d');
 expect((await (await s.send('/member/account/leave',undefined,d.token)).json()).blockers).toEqual([]);
 await s.unit.run(store=>{
  store.map<any>('member_operations').set('op-1',{id:'op-1',kind:'physical_statement',offer:'offer-1',mandate:'mandate-1',presenter:'merchant-1',canonical:'valence.statement.1\noffer-1\n',reviewedRevision:'r',principal:'leaver-d',credential:d.key.id,household:d.household,keyFingerprint:'f',requestDigest:'d',challenge:'c',createdAt:now(),state:'prepared',assertionFingerprint:null,receiptDigest:null,refusal:null,expiresAt:now()+10000});
 });
 const withOperation=await (await s.send('/member/account/leave',undefined,d.token)).json();
 expect(withOperation.blockers).toEqual([{kind:'operation_pending',id:'op-1'}]);
 await s.unit.run(store=>{store.map<any>('member_operations').delete('op-1');});
 await s.unit.run(store=>{
  store.map<any>('member_mandate_changes').set('change-1',{id:'change-1',before:{},mandate:{household:d.household},requiredSigners:[d.household],assertions:{},state:'pending',createdAt:now(),updatedAt:now()});
 });
 const withMandateChange=await (await s.send('/member/account/leave',undefined,d.token)).json();
 expect(withMandateChange.blockers).toEqual([{kind:'mandate_change_pending',id:'change-1'}]);
 await s.unit.run(store=>{store.map<any>('member_mandate_changes').delete('change-1');});
 await s.unit.run(store=>{
  store.map<any>('member_recovery_requests').set('request-1',{id:'request-1',owner:d.household,recoverer:'another-household',epoch:1,requesterPublicKey:'k',hostShare:'h',recovererPacket:'p',keyDigest:'k',noticeChannel:'anc1_x',state:'pending',release:null,noticeID:null,noticeReceipt:null,createdAt:now(),updatedAt:now()});
 });
 const withRecoveryRequest=await (await s.send('/member/account/leave',undefined,d.token)).json();
 expect(withRecoveryRequest.blockers).toEqual([{kind:'recovery_request_pending',id:'request-1'}]);
 await s.unit.run(store=>{store.map<any>('member_recovery_requests').delete('request-1');});
 expect((await (await s.send('/member/account/leave',undefined,d.token)).json()).blockers).toEqual([]);
});
