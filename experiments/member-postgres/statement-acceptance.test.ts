import {test,expect} from 'bun:test';
import {createPublicKey,randomUUID} from 'node:crypto';
import {createPool,initialiseDeployment,postgresStore} from './store.ts';
import {openPostgresMemberHTTP} from './http.ts';
import {prepareDeviceAcceptance,deviceAcceptanceStatus,inviteDeviceAcceptance,prepareStatementAcceptance,prepareStatementBox} from './device-acceptance.ts';
import type {MemberRuntimeConfig} from './config.ts';
import {memberRuntime} from './runtime.ts';
import config from './deployment/config.json';
import {syntheticAuthenticator} from '../member-login/fixtures/authenticator.ts';
import {isHouseholdName,householdOfMandate} from '../../engine/src/common/names.ts';
import {credentialSPKI} from '../member-login/credential-key.ts';
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
  await expect(unit.run(s=>prepareStatementAcceptance(s,c))).rejects.toThrow('Exactly one active acceptance credential');
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
  const statement=await unit.run(s=>prepareStatementAcceptance(s,c));
  // The household is adopted from the registered passkey, and the mandate is
  // that identifier with a label, so nothing is registered under a mandate's name.
  expect(isHouseholdName(statement.household)).toBe(true);
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
  const pemOf=(r:ReturnType<typeof memberRuntime>)=>(id:string)=>{const k=r.login.verifiedPublicKey(id);return k===undefined?undefined:createPublicKey({key:credentialSPKI(k),format:'der',type:'spki'}).export({type:'spki',format:'pem'}).toString();};
  await expect(unit.run(s=>{const r=memberRuntime(s,c);return r.authority.adoptHousehold(prepared.principal,r.authority.activeCredentialIDs(prepared.principal)[0]!,pemOf(r));})).rejects.toThrow('Principal has a household');
  await expect(unit.run(s=>{const r=memberRuntime(s,c);r.authority.provisionUnclaimedPrincipal('dev_member_second',[]);return r.authority.adoptHousehold('dev_member_second',r.authority.activeCredentialIDs(prepared.principal)[0]!,pemOf(r));})).rejects.toThrow("Credential is not this principal's");
  // And a household that is a key's name can never be assigned, only adopted.
  await expect(unit.run(s=>memberRuntime(s,c).authority.provisionPrincipal('dev_member_assigned',statement.household,[]))).rejects.toThrow('adopted, not assigned');
  await expect(unit.run(s=>prepareStatementAcceptance(s,c))).rejects.toThrow('already prepared');
  // The grant change revokes the earlier session and the internal binding session leaves nothing live.
  expect((await send('/auth/session',undefined,before)).status).toBe(401);
  expect(await unit.run(s=>[...s.map<{credential:string;revoked:number}>('member_sessions').values()].filter(v=>v.revoked===0).length)).toBe(0);
  expect(await unit.run(s=>deviceAcceptanceStatus(s,c))).toMatchObject({activeCredentials:1,presenterGrants:1,statement:{offer:statement.offer,mandate:statement.mandate,presenter:statement.presenter,settled:false}});
  const token=await signIn(3);
  expect((await (await send('/auth/session',undefined,token)).json()).presenters).toEqual([statement.presenter]);
  const list=await (await send('/offers?household='+encodeURIComponent(statement.household)+'&presenter='+statement.presenter,undefined,token)).json();
  expect(list.offers.map((o:{id:string})=>o.id)).toEqual([statement.offer]);
  expect((await send('/offers/'+statement.offer+'/statement',undefined,token)).status).toBe(200);
  const p=await (await send('/member/statements/prepare',{offer:statement.offer,disputed:[]},token)).json();
  expect(p.publicKey.allowCredentials).toEqual([{type:'public-key',id:key.id}]);
  const path='/member/operations/'+p.operationID,submitted=await send(path+'/submit',{assertion:key.authenticate(p.publicKey.challenge,c.origin,c.rpID,userHandle,4)},token);
  expect(submitted.status).toBe(200);const receipt=await submitted.json();expect(receipt.operationState).toBe('committed');
  expect(await (await send(path+'/outcome',undefined,token)).json()).toEqual(receipt);
  expect(await unit.run(s=>deviceAcceptanceStatus(s,c))).toMatchObject({statement:{settled:true}});
  // A further box comes from a new presenter under the same mandate and waits for its own native approval.
  const box=await unit.run(s=>prepareStatementBox(s,c));
  expect(box.offer).not.toBe(statement.offer);expect(box.presenter).not.toBe(statement.presenter);
  await expect(unit.run(s=>prepareStatementBox(s,c))).rejects.toThrow('not settled');
  expect((await send('/auth/session',undefined,token)).status).toBe(401);
  const again=await signIn(5);
  const next=await (await send('/member/statements/prepare',{offer:box.offer,disputed:[]},again)).json();
  const nextPath='/member/operations/'+next.operationID,approved=await send(nextPath+'/submit',{assertion:key.authenticate(next.publicKey.challenge,c.origin,c.rpID,userHandle,6)},again);
  expect(approved.status).toBe(200);expect((await approved.json()).operationState).toBe('committed');
  expect(await unit.run(s=>deviceAcceptanceStatus(s,c))).toMatchObject({statement:{offer:box.offer,settled:true}});
 }finally{
  await pool.query('DELETE FROM atarasy_member.engine_rows WHERE deployment=$1',[id.id]);await pool.query('DELETE FROM atarasy_member.control WHERE id=$1',[id.id]);await pool.end();
 }
},60000);
