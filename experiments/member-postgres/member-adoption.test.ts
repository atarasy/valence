import {test,expect} from 'bun:test';
import {createPublicKey,randomUUID} from 'node:crypto';
import {createPool,initialiseDeployment,postgresStore} from './store.ts';
import {migrateDatabase} from './migrate.ts';
import {openPostgresMemberHTTP} from './http.ts';
import {memberRuntime} from './runtime.ts';
import {firstMandateClaim} from './member-adoption.ts';
import {nameOf} from '../../engine/src/common/names.ts';
import {credentialSPKI} from '../member-login/credential-key.ts';
import {syntheticAuthenticator} from '../member-login/fixtures/authenticator.ts';
import config from './deployment/config.json';
import type {MemberRuntimeConfig} from './config.ts';
const householdOf=(key:ReturnType<typeof syntheticAuthenticator>)=>nameOf(createPublicKey({key:credentialSPKI(new Uint8Array(key.cose)),format:'der',type:'spki'}).export({type:'spki',format:'pem'}).toString());
test('the first sign-in that proves a credential adopts its household and writes the version-1 claim; registration alone adopts nothing',async()=>{
 const url=process.env.ATARASY_TEST_POSTGRES_URL;if(!url)throw new Error('Isolated PostgreSQL URL required');
 const c=config as MemberRuntimeConfig,id={id:'adopt_'+randomUUID().replaceAll('-',''),environment:c.environment,origin:c.origin,epoch:1};
 const pool=createPool(url),unit=postgresStore(pool,id);
 try{
  await migrateDatabase(url);await initialiseDeployment(pool,id);const app=await openPostgresMemberHTTP(pool,id,c);
  const send=(path:string,body?:unknown,token?:string)=>app.fetch(new Request(c.origin+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),{peer:'adopt-test'});
  // Two units, because a PostgreSQL unit opens each namespace once and the runtime opens the principals itself.
  const state=async(principal:string,household:string)=>{
   const row=await unit.run(s=>s.map<{household:string|null;presenters:string}>('member_principals').get(principal));
   const engine=await unit.run(s=>{const r=memberRuntime(s,c);return {claims:r.engine.mandates.claimsFor(household),identity:r.engine.publicKeyFor(household)??null};});
   return {household:row?.household??null,presenters:row?.presenters,...engine};
  };
  // One member, invited the ordinary way. The invitation now lives its own fourteen days, not a ceremony's five minutes.
  await unit.run(s=>{memberRuntime(s,c).authority.provisionUnclaimedPrincipal('member_a',[]);});
  const invitation=await unit.run(s=>memberRuntime(s,c).enrollment.issueInvitation('member_a'));
  expect(invitation.expiresAt-Date.now()).toBeGreaterThan(c.invitationLifetimeMs-60_000);
  expect(c.invitationLifetimeMs).toBe(14*86_400_000);
  const flow=await (await send('/auth/enrollment/options',{invitation:invitation.token})).json(),key=syntheticAuthenticator(),household=householdOf(key);
  expect((await send('/auth/enrollment/verify',{id:flow.id,response:key.register(flow.publicKey.challenge,c.origin,c.rpID)})).status).toBe(201);
  // Registration alone: attestation 'none' proves no key, so nothing is adopted, claimed or registered.
  expect(await state('member_a',household)).toEqual({household:null,presenters:'[]',claims:[],identity:null});
  const user=flow.publicKey.user.id;
  const signIn=async(k:ReturnType<typeof syntheticAuthenticator>,handle:string,counter:number,id?:string)=>{
   const f=await (await send('/auth/login/options',{})).json(),response=k.authenticate(f.publicKey.challenge,c.origin,c.rpID,handle,counter);
   return send('/auth/login/verify',{id:f.id,response:id?{...response,id,rawId:id}:response});
  };
  // The first sign-in adopts before the session exists, so the session reads the household at once.
  const first=await signIn(key,user,1);expect(first.status).toBe(200);
  const token=(await first.json()).token as string;
  const session=await send('/auth/session',undefined,token);
  expect(session.status).toBe(200);expect((await session.json()).household).toBe(household);
  const adopted=await state('member_a',household);
  expect(adopted.household).toBe(household);expect(adopted.presenters).toBe('[]');expect(adopted.identity).not.toBeNull();
  // The claim is a claim: the server signed nothing, and no mandate exists until the device signs it.
  expect(adopted.claims).toHaveLength(1);
  expect(adopted.claims[0]).toEqual({...firstMandateClaim(household,adopted.claims[0]!.lapses_at-365*86_400_000)});
  expect(await unit.run(s=>memberRuntime(s,c).engine.mandates.get(household+'.1')??null)).toBeNull();
  const listed=await (await send('/member/mandates/list',{},token)).json();
  expect(listed.mandates.map((m:{id:string})=>m.id)).toEqual([household+'.1']);
  // A second sign-in changes nothing, and the first session is still live.
  const second=await signIn(key,user,2);expect(second.status).toBe(200);
  expect(await state('member_a',household)).toEqual(adopted);
  expect((await send('/auth/session',undefined,token)).status).toBe(200);
  // A second principal holding a credential for the same key: its sign-in verifies, and the adoption is refused
  // because another live principal holds that household. Nothing of it is adopted and member_a is untouched.
  const twin='twin'+randomUUID().replaceAll('-',''),twinHandle=randomUUID().replaceAll('-','');
  await unit.run(s=>{const r=memberRuntime(s,c);r.authority.provisionUnclaimedPrincipal('member_twin',[]);r.authority.registerCredential(twin,'member_twin');r.login.provisionVerifiedPasskey(twin,new Uint8Array(key.cose),0,twinHandle);});
  const refused=await signIn(key,twinHandle,3,twin);
  expect(refused.status).not.toBe(200);
  expect(await unit.run(s=>s.map<{household:string|null}>('member_principals').get('member_twin')?.household)).toBeNull();
  expect(await state('member_a',household)).toEqual(adopted);
 }finally{
  await pool.query('DELETE FROM atarasy_member.engine_rows WHERE deployment=$1',[id.id]);await pool.query('DELETE FROM atarasy_member.control WHERE id=$1',[id.id]);await pool.end();
 }
},60000);
