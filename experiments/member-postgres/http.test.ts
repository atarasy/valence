import { signConfig } from '../../engine/test/helpers.ts';
import {beforeAll,afterAll,expect,test} from 'bun:test';
import {canonicalWithdrawal,canonicalDecisions} from '../../engine/src/shared/decisions.ts';
import {canonicalMandate} from '../../engine/src/hub/mandates.ts';
import {createPublicKey,randomUUID,sign} from 'node:crypto';
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
const url=process.env.ATARASY_TEST_POSTGRES_URL;if(!url)throw new Error('Explicit isolated ATARASY_TEST_POSTGRES_URL required');
const pool=createPool(url),ids:string[]=[];
const config:MemberRuntimeConfig={environment:'test',origin:'https://unit.example',rpID:'unit.example',explorationRate:0.2,reminderLimit:1,recoveryGraceDays:3,dayBoundary:'UTC',maximumLifetimeMs:60000,maxSessionLifetimeMs:100000,maximumBodyBytes:20000,bodyTimeoutMs:100,maximumPending:8,budgetWindowMs:60000,maximumRequests:100,maximumTrackedTokens:100};
const now=()=>fixtureTime+1;
const coseOf=(pair:{publicKey:{export:(o:any)=>any}})=>{const jwk=pair.publicKey.export({format:'jwk'});return Buffer.concat([Buffer.from('a5010203262001215820','hex'),Buffer.from(jwk.x!,'base64url'),Buffer.from('225820','hex'),Buffer.from(jwk.y!,'base64url')]);};
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
 const presenterToken=await s.unit.run(store=>presenterCredentials(memberRuntime(store,s.c,now)).issue('merchant-1',now()).token);
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
test.skipIf(!process.env.VOX_TEST_SOURCE)('Vox service quotation reaches member preparation and signed digital decision',async()=>{
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
