import { signConfig } from '../../engine/test/helpers.ts';
import {beforeAll,afterAll,expect,test} from 'bun:test';
import {createPublicKey,randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Database} from 'bun:sqlite';
import {createPool,initialiseDeployment,postgresStore,type Identity} from './store.ts';
import {migrateDatabase} from './migrate.ts';
import {openPostgresMemberHTTP} from './http.ts';
import {credentialSPKI} from '../member-login/credential-key.ts';
import {isHouseholdName,nameOf} from '../../engine/src/common/names.ts';
import {memberRuntime} from './runtime.ts';
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
async function digitalSetup(){
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
  r.deliveries.record({offer:o.id,carriage:550,code:'digital-test-carriage',status:'placed',now:now()});
  const {ApprovalDesk}=await import('../../engine/src/hub/approval.ts');
  new ApprovalDesk(store).record({offer:o.id,perCandidate:Object.fromEntries(o.candidates.map(c=>[c.id,{alternatives:['Use existing supplies'],argument_against:'You may already have enough.'}])),excluded:[],mandate:{kind:'standing',scope:'Test supplies',lapses_at:fixtureTime+10000000}});
  r.authority.bindResource({kind:'offer',id:o.id},{household:s.input.house,presenter:'merchant-1'});
  return o;
 });
 const decisions=offer.candidates.map(c=>({candidate:c.id,valence:'kept',kept_as:'self'}));
 const prepare=()=>s.send('/member/decisions/prepare',{offer:offer.id,decisions});
 return {...s,offer,decisions,prepare};
}
test('digital decision commits once across independent HTTP runtimes and retains the original result',async()=>{
 const s=await digitalSetup(),reply=await s.prepare();expect(reply.status).toBe(200);const p=await reply.json();
 expect(p.profile).toBe('atarasy.member-decision-authorisation.1');expect(p.review.goods).toBe(1200);expect(p.review.carriage).toBe(550);expect(p.review.total).toBe(1750);
 const repeated=await (await s.prepare()).json();expect(repeated.operationID).toBe(p.operationID);
 const assertion=loginResponse(s.pair,s.input.credential,s.user,p.publicKey.challenge,3),path='/member/operations/'+p.operationID;
 const second=await openPostgresMemberHTTP(pool,s.identity,s.c,now);
 const replies=await Promise.all([s.send(path+'/submit',{assertion}),second.fetch(s.request(path+'/submit',{assertion},s.grant.token),{peer:'digital-other'})]);
 expect(replies.map(r=>r.status)).toEqual([200,200]);const result=await replies[0]!.json();expect(await replies[1]!.json()).toEqual(result);
 expect(result.operationState).toBe('committed');expect(result.decision.state).toBe('decided');expect(result.decision.candidates[0].valence).toBe('kept');
 expect(result.receipt).toBeUndefined();
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
 await s.unit.run(store=>store.map('delivery').delete(s.offer.id));
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
