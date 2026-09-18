import {test,expect} from 'bun:test';
import {createPublicKey,randomUUID} from 'node:crypto';
import {createPool,initialiseDeployment,postgresStore} from './store.ts';
import {openPostgresMemberHTTP} from './http.ts';
import {prepareDeviceAcceptance,deviceAcceptanceStatus,inviteDeviceAcceptance,prepareStatementAcceptance,prepareStatementBox,retireUnprovenCredentials} from './device-acceptance.ts';
import type {MemberRuntimeConfig} from './config.ts';
import {memberRuntime} from './runtime.ts';
import config from './deployment/config.json';
import {syntheticAuthenticator} from '../member-login/fixtures/authenticator.ts';
import {isHouseholdName,householdOfMandate,nameOf} from '../../engine/src/common/names.ts';
import {credentialSPKI} from '../member-login/credential-key.ts';
// §10.5. The engine reads an assertion's three fields as base64; the synthetic
// authenticator speaks WebAuthn, which is base64url. Converting here rather
// than widening the engine keeps one encoding in the protocol.
const assertionFor=(key:ReturnType<typeof syntheticAuthenticator>,challenge:string,c:MemberRuntimeConfig,counter:number)=>{
 const r=key.authenticate(challenge,c.origin,c.rpID,'',counter).response as {clientDataJSON:string;authenticatorData:string;signature:string};
 const b64=(v:string)=>Buffer.from(v,'base64url').toString('base64');
 return {client_data_json:b64(r.clientDataJSON),authenticator_data:b64(r.authenticatorData),signature:b64(r.signature)};
};
test('trusted statement acceptance lets the registered passkey approve one physical statement through HTTP',async()=>{
 const url=process.env.ATARASY_TEST_POSTGRES_URL;if(!url)throw new Error('Isolated PostgreSQL URL required');
 const pool=createPool(url),c=config as MemberRuntimeConfig,id={id:'statement_'+randomUUID().replaceAll('-',''),environment:c.environment,origin:c.origin,epoch:1},unit=postgresStore(pool,id);
 try{
  await initialiseDeployment(pool,id);const app=await openPostgresMemberHTTP(pool,id,c);
  const send=(path:string,body?:unknown,token?:string)=>app.fetch(new Request(c.origin+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),{peer:'statement-test'});
  const prepared=await unit.run(s=>prepareDeviceAcceptance(s,c));
  // §13.2, question 55. Preparation cannot name the household: its identifier is
  // the name of the passkey the device has not registered yet.
  expect(prepared.household).toBeNull();
  await expect(unit.run(s=>prepareStatementAcceptance(s,c))).rejects.toThrow('0 have signed in and 0 have not');
  // A registration that never signs in leaves a credential that can do nothing.
  // Counting active credentials made `statement` refuse for ever as soon as one
  // existed, with no command that cleared it, so it counts signed-in ones and
  // `retire` revokes the rest. Measured by a fourth refutation pass 2026-09-16.
  const spent=syntheticAuthenticator(),wrong=await unit.run(s=>inviteDeviceAcceptance(s,c));
  const spentFlow=await (await send('/auth/enrollment/options',{invitation:wrong.token})).json();
  expect((await send('/auth/enrollment/verify',{id:spentFlow.id,response:spent.register(spentFlow.publicKey.challenge,c.origin,c.rpID)})).status).toBe(201);
  await expect(unit.run(s=>prepareStatementAcceptance(s,c))).rejects.toThrow('0 have signed in and 1 have not');
  // A second credential beside a signed-in one is the state a fifth pass
  // measured: the step proceeded silently, adopted whichever had signed in, and
  // left the other reading the household with nothing proven and no way to
  // remove it. One credential, and it must have signed.
  const spentToken=await (async()=>{const f=await (await send('/auth/login/options',{})).json();const r=await send('/auth/login/verify',{id:f.id,response:spent.authenticate(f.publicKey.challenge,c.origin,c.rpID,spentFlow.publicKey.user.id,1)});expect(r.status).toBe(200);return (await r.json()).token as string;})();
  expect((await send('/auth/session',undefined,spentToken)).status).toBe(401);
  const extra=syntheticAuthenticator(),extraInvite=await unit.run(s=>inviteDeviceAcceptance(s,c));
  const extraFlow=await (await send('/auth/enrollment/options',{invitation:extraInvite.token})).json();
  expect((await send('/auth/enrollment/verify',{id:extraFlow.id,response:extra.register(extraFlow.publicKey.challenge,c.origin,c.rpID)})).status).toBe(201);
  await expect(unit.run(s=>prepareStatementAcceptance(s,c))).rejects.toThrow('1 have signed in and 1 have not');
  // `retire` undoes the whole enrolment step, signed-in credentials included,
  // because nothing has been adopted yet and a deployment with two signed-in
  // credentials was one no command could leave.
  // An invitation outstanding when the enrolment is undone becomes a credential
  // afterwards unless it is dropped with the rest.
  const stranded=await unit.run(s=>inviteDeviceAcceptance(s,c));
  // And a ceremony opened and not finished: finishing it after the enrolment is
  // undone would produce a credential, so it is dropped with the rest.
  const openCeremony=syntheticAuthenticator(),opening=await unit.run(s=>inviteDeviceAcceptance(s,c));
  const openFlow=await (await send('/auth/enrollment/options',{invitation:opening.token})).json();
  expect(await unit.run(s=>s.map('member_flows').size)).toBe(1);
  expect(await unit.run(s=>retireUnprovenCredentials(s,c))).toEqual({retired:2,signedIn:1,unproven:1,cancelled:2});
  expect((await send('/auth/enrollment/verify',{id:openFlow.id,response:openCeremony.register(openFlow.publicKey.challenge,c.origin,c.rpID)})).status).toBe(401);
  expect((await send('/auth/enrollment/options',{invitation:stranded.token})).status).toBe(401);
  // A half-finished ceremony is dropped too, not only the invitation that
  // opened it: finishing it afterwards would produce a credential.
  expect(await unit.run(s=>s.map('member_flows').size)).toBe(0);
  // And the device can enrol again, which is what the message tells the
  // operator to do. Revoking the rows instead of removing them made the same
  // credential id and user handle unusable for the life of the deployment.
  const reInvite=await unit.run(s=>inviteDeviceAcceptance(s,c));
  const reFlow=await (await send('/auth/enrollment/options',{invitation:reInvite.token})).json();
  expect((await send('/auth/enrollment/verify',{id:reFlow.id,response:spent.register(reFlow.publicKey.challenge,c.origin,c.rpID)})).status).toBe(201);
  expect(await unit.run(s=>retireUnprovenCredentials(s,c))).toMatchObject({retired:1,signedIn:0,unproven:1});
  // The counts are computed before anything is revoked, so the rows are read
  // back: an earlier version returned the same object and revoked less.
  expect(await unit.run(s=>{const rows=s.map<{revoked:number}>('member_credentials');return [...rows.values()].every(v=>v.revoked===1);})).toBe(true);
  const invitation=await unit.run(s=>inviteDeviceAcceptance(s,c)),key=syntheticAuthenticator();
  const flow=await (await send('/auth/enrollment/options',{invitation:invitation.token})).json();
  expect((await send('/auth/enrollment/verify',{id:flow.id,response:key.register(flow.publicKey.challenge,c.origin,c.rpID)})).status).toBe(201);
  const userHandle=flow.publicKey.user.id,signIn=async(counter:number)=>{const f=await (await send('/auth/login/options',{})).json();const reply=await send('/auth/login/verify',{id:f.id,response:key.authenticate(f.publicKey.challenge,c.origin,c.rpID,userHandle,counter)});expect(reply.status).toBe(200);return (await reply.json()).token as string;};
  // A device that has enrolled but whose principal has not adopted a household
  // holds a session it can end. A refutation pass measured the opposite: the
  // resolver threw, the transport swallowed the throw, and the revoke never
  // ran, so the session stayed live for its full hour.
  const unclaimed=await signIn(1);
  expect((await send('/auth/session',undefined,unclaimed)).status).toBe(401);
  expect((await send('/auth/logout',{},unclaimed)).status).toBe(204);
  expect(await unit.run(s=>[...s.map<{revoked:number}>('member_sessions').values()].filter(v=>v.revoked===0).length)).toBe(0);
  const before=await signIn(2);
  // A ceremony held open across the step that adopts the household: the check
  // at the step counts credentials and cannot see one arriving after it, so the
  // route that adds a credential is where the invariant lives. Measured open by
  // a sixth refutation pass, which then read the household's mandate terms.
  const late=syntheticAuthenticator(),lateInvite=await unit.run(s=>inviteDeviceAcceptance(s,c));
  const lateFlow=await (await send('/auth/enrollment/options',{invitation:lateInvite.token})).json();
  // §16.1, question 56. The step writes the mandate as a claim and stops; the
  // device signs it with the passkey its household is named after, and the step
  // presents the box on the second run. Until it is signed, no offer can name it.
  const awaiting=await unit.run(s=>prepareStatementAcceptance(s,c)) as {mandate:string;awaitingSignature:true};
  expect(awaiting.awaitingSignature).toBe(true);
  const toSign=await (await send('/member/mandates/prepare',{},before)).json();
  expect(toSign.mandate.id).toBe(awaiting.mandate);
  expect((await send('/member/mandates/submit',{assertion:assertionFor(key,toSign.publicKey.challenge,c,3)},before)).status).toBe(200);
  const statement=await unit.run(s=>prepareStatementAcceptance(s,c)) as {household:string;mandate:string;offer:string;presenter:string};
  expect((await send('/auth/enrollment/verify',{id:lateFlow.id,response:late.register(lateFlow.publicKey.challenge,c.origin,c.rpID)})).status).toBe(401);
  expect(await unit.run(s=>s.map('member_passkeys').has(late.id))).toBe(false);
  // And retire refuses once a statement exists, which had no test at all.
  await expect(unit.run(s=>retireUnprovenCredentials(s,c))).rejects.toThrow('already prepared');
  // The household is adopted from the registered passkey, and the mandate is
  // that identifier with a label, so nothing is registered under a mandate's name.
  expect(isHouseholdName(statement.household)).toBe(true);
  // The adopted name is this credential's stored key and not any other value:
  // for four commits the authority took the name from its caller instead.
  expect(await unit.run(s=>{const row=s.map<{public_key:number[]}>('member_passkeys').get(key.id)!;
   return nameOf(createPublicKey({key:credentialSPKI(new Uint8Array(row.public_key)),format:'der',type:'spki'}).export({type:'spki',format:'pem'}).toString());})).toBe(statement.household);
  // The key reader is bound once, by the login that holds the passkeys.
  await expect(unit.run(s=>memberRuntime(s,c).authority.useCredentialKeys(()=>'not a key'))).rejects.toThrow('already bound');
  expect(householdOfMandate(statement.mandate)).toBe(statement.household);
  expect(await unit.run(s=>deviceAcceptanceStatus(s,c))).toMatchObject({household:statement.household});
  // Nobody signed this mandate, and it is written under a real key's name. The
  // ceiling is one box's price, which is what §16.2 bounds: carriage is not in
  // it. It contains nothing on this service, because no registry is supplied
  // and every merchant then reads as in network, so this assertion is about the
  // number being right where it is read and not about anything it stops.
  expect(await unit.run(s=>s.map<{household:string;ceiling_out_of_network:number;ceiling_daily:number|null;co_signers:string[];version:number}>('mandates').get(statement.mandate)))
   .toMatchObject({household:statement.household,ceiling_out_of_network:1200,co_signers:[],version:1});
  await expect(unit.run(s=>s.map<{household:string}>('member_principals').get(prepared.principal)?.household)).resolves.toBe(statement.household);
  // The transition runs once, and the name is derived from the key the
  // principal holds rather than taken from the caller. There is no uniqueness
  // check on purpose: one measured earlier let a planted row claim a key's
  // name permanently, which is the registry question 55 abolished.
  await expect(unit.run(s=>{const r=memberRuntime(s,c);return r.authority.adoptHousehold(prepared.principal,r.authority.activeCredentialIDs(prepared.principal)[0]!);})).rejects.toThrow('Principal has a household');
  await expect(unit.run(s=>{const r=memberRuntime(s,c);r.authority.provisionUnclaimedPrincipal('dev_member_second',[]);return r.authority.adoptHousehold('dev_member_second',r.authority.activeCredentialIDs(prepared.principal)[0]!);})).rejects.toThrow("Credential is not this principal's");
  // And a household that is a key's name can never be assigned, only adopted.
  await expect(unit.run(s=>memberRuntime(s,c).authority.provisionPrincipal('dev_member_assigned',statement.household,[]))).rejects.toThrow('adopted, not assigned');
  await expect(unit.run(s=>prepareStatementAcceptance(s,c))).rejects.toThrow('already prepared');
  // The grant change revokes the earlier session and the internal binding session leaves nothing live.
  expect((await send('/auth/session',undefined,before)).status).toBe(401);
  expect(await unit.run(s=>[...s.map<{credential:string;revoked:number}>('member_sessions').values()].filter(v=>v.revoked===0).length)).toBe(0);
  expect(await unit.run(s=>deviceAcceptanceStatus(s,c))).toMatchObject({activeCredentials:1,presenterGrants:1,statement:{offer:statement.offer,mandate:statement.mandate,presenter:statement.presenter,settled:false}});
  const token=await signIn(4);
  expect((await (await send('/auth/session',undefined,token)).json()).presenters).toEqual([statement.presenter]);
  const list=await (await send('/offers?household='+encodeURIComponent(statement.household)+'&presenter='+statement.presenter,undefined,token)).json();
  expect(list.offers.map((o:{id:string})=>o.id)).toEqual([statement.offer]);
  expect((await send('/offers/'+statement.offer+'/statement',undefined,token)).status).toBe(200);
  const p=await (await send('/member/statements/prepare',{offer:statement.offer,disputed:[]},token)).json();
  expect(p.publicKey.allowCredentials).toEqual([{type:'public-key',id:key.id}]);
  const path='/member/operations/'+p.operationID,submitted=await send(path+'/submit',{assertion:key.authenticate(p.publicKey.challenge,c.origin,c.rpID,userHandle,5)},token);
  expect(submitted.status).toBe(200);const receipt=await submitted.json();expect(receipt.operationState).toBe('committed');
  expect(await (await send(path+'/outcome',undefined,token)).json()).toEqual(receipt);
  expect(await unit.run(s=>deviceAcceptanceStatus(s,c))).toMatchObject({statement:{settled:true}});
  // A further box comes from a new presenter under the same mandate and waits for its own native approval.
  const box=await unit.run(s=>prepareStatementBox(s,c));
  expect(box.offer).not.toBe(statement.offer);expect(box.presenter).not.toBe(statement.presenter);
  await expect(unit.run(s=>prepareStatementBox(s,c))).rejects.toThrow('not settled');
  expect((await send('/auth/session',undefined,token)).status).toBe(401);
  const again=await signIn(6);
  const next=await (await send('/member/statements/prepare',{offer:box.offer,disputed:[]},again)).json();
  const nextPath='/member/operations/'+next.operationID,approved=await send(nextPath+'/submit',{assertion:key.authenticate(next.publicKey.challenge,c.origin,c.rpID,userHandle,7)},again);
  expect(approved.status).toBe(200);expect((await approved.json()).operationState).toBe('committed');
  expect(await unit.run(s=>deviceAcceptanceStatus(s,c))).toMatchObject({statement:{offer:box.offer,settled:true}});
 }finally{
  await pool.query('DELETE FROM atarasy_member.engine_rows WHERE deployment=$1',[id.id]);await pool.query('DELETE FROM atarasy_member.control WHERE id=$1',[id.id]);await pool.end();
 }
},60000);
