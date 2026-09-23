import {test,expect} from 'bun:test';
import {randomUUID} from 'node:crypto';
import {createPool,initialiseDeployment,postgresStore} from './store.ts';
import {openPostgresMemberHTTP} from './http.ts';
import {prepareDeviceAcceptance,deviceAcceptanceStatus,inviteDeviceAcceptance,prepareStatementAcceptance,rearmDeviceAcceptance} from './device-acceptance.ts';
import {memberRuntime} from './runtime.ts';
import type {MemberRuntimeConfig} from './config.ts';
import config from './deployment/config.json';
import {syntheticAuthenticator} from '../member-login/fixtures/authenticator.ts';
// §10.5. The mandate ceremony reads an assertion's three fields as base64;
// the synthetic authenticator speaks WebAuthn, which is base64url. Copied
// from statement-acceptance.test.ts, which exercises the same ceremony.
const assertionFor=(key:ReturnType<typeof syntheticAuthenticator>,challenge:string,c:MemberRuntimeConfig,counter:number)=>{
 const r=key.authenticate(challenge,c.origin,c.rpID,'',counter).response as {clientDataJSON:string;authenticatorData:string;signature:string};
 const b64=(v:string)=>Buffer.from(v,'base64url').toString('base64');
 return {client_data_json:b64(r.clientDataJSON),authenticator_data:b64(r.authenticatorData),signature:b64(r.signature)};
};
test('trusted acceptance survives duplicate preparation, registers through HTTP, and refuses changed grants',async()=>{
 const url=process.env.ATARASY_TEST_POSTGRES_URL;if(!url)throw new Error('Isolated PostgreSQL URL required');
 const pool=createPool(url),c=config as MemberRuntimeConfig,id={id:'accept_'+randomUUID().replaceAll('-',''),environment:c.environment,origin:c.origin,epoch:1},unit=postgresStore(pool,id);
 try{
  await initialiseDeployment(pool,id);const app=await openPostgresMemberHTTP(pool,id,c);
  const prepared=await unit.run(s=>prepareDeviceAcceptance(s,c));
  await expect(unit.run(s=>prepareDeviceAcceptance(s,c))).rejects.toThrow('already prepared');
  expect(await unit.run(s=>deviceAcceptanceStatus(s,c))).toMatchObject({...prepared,prepared:true,activeCredentials:0,presenterGrants:0});
  const invitation=await unit.run(s=>inviteDeviceAcceptance(s,c));
  const post=(path:string,body:unknown)=>app.fetch(new Request(c.origin+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),{peer:'acceptance-test'});
  const start=await post('/auth/enrollment/options',{invitation:invitation.token});expect(start.status).toBe(200);const flow=await start.json(),key=syntheticAuthenticator();
  expect((await post('/auth/enrollment/verify',{id:flow.id,response:key.register(flow.publicKey.challenge,c.origin,c.rpID)})).status).toBe(201);
  expect((await post('/auth/enrollment/options',{invitation:invitation.token})).status).toBe(401);
  expect(await unit.run(s=>deviceAcceptanceStatus(s,c))).toMatchObject({activeCredentials:1,presenterGrants:0});
  await unit.run(s=>memberRuntime(s,c).authority.setPresenterGrants(prepared.principal,['unexpected-presenter']));
  await expect(unit.run(s=>inviteDeviceAcceptance(s,c))).rejects.toThrow('changed or unavailable');
  await expect(unit.run(s=>deviceAcceptanceStatus(s,c))).rejects.toThrow('changed or unavailable');
 }finally{
  await pool.query('DELETE FROM atarasy_member.engine_rows WHERE deployment=$1',[id.id]);await pool.query('DELETE FROM atarasy_member.control WHERE id=$1',[id.id]);await pool.end();
 }
},60000);
test('rearm refuses with no current, refuses a live household, and only rearms once §14.3 has actually removed it',async()=>{
 const url=process.env.ATARASY_TEST_POSTGRES_URL;if(!url)throw new Error('Isolated PostgreSQL URL required');
 const pool=createPool(url),c=config as MemberRuntimeConfig,id={id:'rearm_'+randomUUID().replaceAll('-',''),environment:c.environment,origin:c.origin,epoch:1},unit=postgresStore(pool,id);
 try{
  await initialiseDeployment(pool,id);const app=await openPostgresMemberHTTP(pool,id,c);
  const send=(path:string,body?:unknown,token?:string)=>app.fetch(new Request(c.origin+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),{peer:'rearm-test'});
  // Nothing prepared at all.
  await expect(unit.run(s=>rearmDeviceAcceptance(s,c))).rejects.toThrow('not prepared');
  const prepared=await unit.run(s=>prepareDeviceAcceptance(s,c)),key=syntheticAuthenticator();
  // A `current` that has not adopted a household yet: nothing to depart, `retire` is the command for this.
  await expect(unit.run(s=>rearmDeviceAcceptance(s,c))).rejects.toThrow('never adopted');
  const invitation=await unit.run(s=>inviteDeviceAcceptance(s,c));
  const flow=await (await send('/auth/enrollment/options',{invitation:invitation.token})).json();
  expect((await send('/auth/enrollment/verify',{id:flow.id,response:key.register(flow.publicKey.challenge,c.origin,c.rpID)})).status).toBe(201);
  const userHandle=flow.publicKey.user.id;
  const signIn=async(counter:number)=>{const f=await (await send('/auth/login/options',{})).json();const reply=await send('/auth/login/verify',{id:f.id,response:key.authenticate(f.publicKey.challenge,c.origin,c.rpID,userHandle,counter)});expect(reply.status).toBe(200);return (await reply.json()).token as string;};
  const before=await signIn(1);
  // §16.1: the first `statement` writes the mandate as a claim, the device signs it, and the second `statement` presents the box.
  const awaiting=await unit.run(s=>prepareStatementAcceptance(s,c)) as {household:string;mandate:string;awaitingSignature:true};
  const named=await (await send('/member/mandates/prepare',{mandate:awaiting.mandate},before)).json();
  expect((await send('/member/mandates/submit',{assertion:assertionFor(key,named.publicKey.challenge,c,2),mandate:awaiting.mandate},before)).status).toBe(200);
  const statement=await unit.run(s=>prepareStatementAcceptance(s,c)) as {household:string;mandate:string;offer:string;presenter:string};
  expect(statement.household).toBe(awaiting.household);
  // A live, adopted household that has not left this host: still refused.
  await expect(unit.run(s=>rearmDeviceAcceptance(s,c))).rejects.toThrow('has not left this host');
  // Changing the grant to the box's presenter revoked the earlier session.
  const session=await signIn(3);
  const p=await (await send('/member/statements/prepare',{offer:statement.offer,disputed:[]},session)).json();
  const settled=await send('/member/operations/'+p.operationID+'/submit',{assertion:key.authenticate(p.publicKey.challenge,c.origin,c.rpID,userHandle,4)},session);
  expect(settled.status).toBe(200);
  // §14.3: leave this host through the real ceremony, exactly as `member-leave.ts`'s own tests do.
  expect((await send('/member/account/leave',undefined,session)).status).toBe(200);
  const review=await (await send('/member/account/leave/prepare',{},session)).json();
  const leaveAssertion=key.authenticate(review.publicKey.challenge,c.origin,c.rpID,userHandle,5);
  const left=await send('/member/account/leave/submit',{preparation:review.id,assertion:leaveAssertion},session);
  expect(left.status).toBe(200);
  expect(await left.json()).toMatchObject({profile:'atarasy.member-left.1',household:statement.household});
  // Now the departure is real: rearm succeeds and archives the run rather than discarding it.
  const rearmed=await unit.run(s=>rearmDeviceAcceptance(s,c));
  expect(rearmed).toMatchObject({rearmed:true,household:statement.household});
  expect(await unit.run(s=>deviceAcceptanceStatus(s,c))).toMatchObject({prepared:false,archived:[{household:statement.household,archivedAt:rearmed.archivedAt}]});
  expect(await unit.run(s=>{const entries=s.map<unknown>('member_device_acceptance');return {current:entries.has('current'),archivedCurrent:entries.has(`departed:${statement.household}:${rearmed.archivedAt}:current`),archivedStatement:entries.has(`departed:${statement.household}:${rearmed.archivedAt}:statement`)};})).toEqual({current:false,archivedCurrent:true,archivedStatement:true});
  // A second rearm refuses: `current` is empty, so there is nothing left to rearm.
  await expect(unit.run(s=>rearmDeviceAcceptance(s,c))).rejects.toThrow('not prepared');
  // `prepare` then `invite` work again, exactly as on a fresh deployment.
  const reprepared=await unit.run(s=>prepareDeviceAcceptance(s,c));
  expect(reprepared.principal).not.toBe(prepared.principal);
  expect(reprepared.household).toBeNull();
  const reinvited=await unit.run(s=>inviteDeviceAcceptance(s,c));
  expect(reinvited.expiresAt).toBeGreaterThan(Date.now());
 }finally{
  await pool.query('DELETE FROM atarasy_member.engine_rows WHERE deployment=$1',[id.id]);await pool.query('DELETE FROM atarasy_member.control WHERE id=$1',[id.id]);await pool.end();
 }
},60000);
