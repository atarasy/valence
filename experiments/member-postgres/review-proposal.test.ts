import {test,expect} from 'bun:test';
import {randomUUID} from 'node:crypto';
import {createPool,initialiseDeployment,postgresStore} from './store.ts';
import {migrateDatabase} from './migrate.ts';
import {openPostgresMemberHTTP} from './http.ts';
import {memberRuntime} from './runtime.ts';
import {issueReviewInvitation} from './review-invitation.ts';
import {proposeForReview,REVIEW_GOODS,REVIEW_SHOP} from './review-proposal.ts';
import {TARGETS} from './deployment/targets.ts';
import {syntheticAuthenticator} from '../member-login/fixtures/authenticator.ts';
import type {MemberRuntimeConfig} from './config.ts';
// §10.5. The mandate ceremony reads an assertion's three fields as base64; the synthetic authenticator speaks base64url.
const assertionFor=(key:ReturnType<typeof syntheticAuthenticator>,challenge:string,c:MemberRuntimeConfig,counter:number)=>{
 const r=key.authenticate(challenge,c.origin,c.rpID,'',counter).response as {clientDataJSON:string;authenticatorData:string;signature:string};
 const b64=(v:string)=>Buffer.from(v,'base64url').toString('base64');
 return {client_data_json:b64(r.clientDataJSON),authenticator_data:b64(r.authenticatorData),signature:b64(r.signature)};
};
test('a review principal adopts its household, signs its mandate, and decides a presented digital proposal with nothing charged',async()=>{
 const url=process.env.ATARASY_TEST_POSTGRES_URL;if(!url)throw new Error('Isolated PostgreSQL URL required');
 const c=TARGETS.production.config,dev=TARGETS.development.config;
 const id={id:'review_'+randomUUID().replaceAll('-',''),environment:c.environment,origin:c.origin,epoch:1};
 const devID={id:'reviewdev_'+randomUUID().replaceAll('-',''),environment:dev.environment,origin:dev.origin,epoch:1};
 const pool=createPool(url),unit=postgresStore(pool,id);
 try{
  await migrateDatabase(url);await initialiseDeployment(pool,id);const app=await openPostgresMemberHTTP(pool,id,c);
  const send=(path:string,body?:unknown,token?:string)=>app.fetch(new Request(c.origin+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),{peer:'review-test'});
  // Only a principal issued for review, and only in production.
  await expect(unit.run(s=>{memberRuntime(s,c).authority.provisionUnclaimedPrincipal('review_member_'+'0'.repeat(32),[]);return 1;})).resolves.toBe(1);
  await expect(unit.run(s=>proposeForReview(s,c,'review_member_'+'0'.repeat(32)))).rejects.toThrow('Not a review principal');
  await initialiseDeployment(pool,devID);await openPostgresMemberHTTP(pool,devID,dev);
  await expect(postgresStore(pool,devID).run(s=>proposeForReview(s,dev,'review_member_x'))).rejects.toThrow('Review configuration unavailable');

  const invitation=await unit.run(s=>issueReviewInvitation(s,c)),principal=invitation.principal;
  // Nothing enrolled yet: refused before anything is written.
  await expect(unit.run(s=>proposeForReview(s,c,principal))).rejects.toThrow('0 have signed in and 0 have not');
  const flow=await (await send('/auth/enrollment/options',{invitation:invitation.token})).json(),key=syntheticAuthenticator();
  expect((await send('/auth/enrollment/verify',{id:flow.id,response:key.register(flow.publicKey.challenge,c.origin,c.rpID)})).status).toBe(201);
  // Enrolled and never signed: a registration proves no key.
  await expect(unit.run(s=>proposeForReview(s,c,principal))).rejects.toThrow('0 have signed in and 1 have not');
  const userHandle=flow.publicKey.user.id;
  const signIn=async(counter:number)=>{const f=await (await send('/auth/login/options',{})).json();const reply=await send('/auth/login/verify',{id:f.id,response:key.authenticate(f.publicKey.challenge,c.origin,c.rpID,userHandle,counter)});expect(reply.status).toBe(200);return (await reply.json()).token as string;};
  const before=await signIn(1);
  // First run: the household is adopted from the passkey and the mandate is a claim the device must sign.
  const awaiting=await unit.run(s=>proposeForReview(s,c,principal)) as {household:string;mandate:string;awaitingSignature:true};
  expect(awaiting).toMatchObject({awaitingSignature:true,mandate:awaiting.household+'.1'});
  expect(awaiting.household).toMatch(/^key:/);
  // A second run before the device signs writes nothing new and still waits.
  expect(await unit.run(s=>proposeForReview(s,c,principal))).toEqual(awaiting);
  const named=await (await send('/member/mandates/prepare',{mandate:awaiting.mandate},before)).json();
  expect((await send('/member/mandates/submit',{assertion:assertionFor(key,named.publicKey.challenge,c,2),mandate:awaiting.mandate},before)).status).toBe(200);
  // Second run: the review shop is registered and one digital proposal of three goods is presented.
  const proposed=await unit.run(s=>proposeForReview(s,c,principal)) as {household:string;mandate:string;presenter:string;offer:string};
  expect(proposed).toMatchObject({household:awaiting.household,mandate:awaiting.mandate,presenter:REVIEW_SHOP.presenter});
  await expect(unit.run(s=>proposeForReview(s,c,principal))).rejects.toThrow('already presented');
  // The grant change revoked the earlier session.
  expect((await send('/auth/session',undefined,before)).status).toBe(401);
  const token=await signIn(3);
  expect((await (await send('/auth/session',undefined,token)).json()).presenters).toEqual([REVIEW_SHOP.presenter]);
  const list=await (await send('/offers?household='+encodeURIComponent(proposed.household)+'&presenter='+REVIEW_SHOP.presenter,undefined,token)).json();
  expect(list.offers.map((o:{id:string})=>o.id)).toEqual([proposed.offer]);
  const detail=await (await send('/offers/'+proposed.offer,undefined,token)).json();
  expect(detail.binding).toBe('digital');expect(detail.state).toBe('presented');
  expect(detail.candidates.map((v:{product:string})=>v.product).sort()).toEqual(Object.keys(REVIEW_GOODS).sort());
  // The reviewer keeps one line and returns the rest. The review shows goods and zero carriage; no provider exists to call.
  const decisions=detail.candidates.map((v:{id:string},i:number)=>i===0?{candidate:v.id,valence:'kept',kept_as:'self'}:{candidate:v.id,valence:'returned'});
  const prepared=await send('/member/decisions/prepare',{offer:proposed.offer,decisions},token);expect(prepared.status).toBe(200);
  const p=await prepared.json();expect(p.review.carriage).toBe(0);
  const submitted=await send('/member/operations/'+p.operationID+'/submit',{assertion:key.authenticate(p.publicKey.challenge,c.origin,c.rpID,userHandle,4)},token);
  expect(submitted.status).toBe(200);const result=await submitted.json();
  expect(result.operationState).toBe('committed');expect(result.decision.state).toBe('decided');expect(result.receipt).toBeUndefined();
 }finally{
  for(const d of [id.id,devID.id]){await pool.query('DELETE FROM atarasy_member.engine_rows WHERE deployment=$1',[d]);await pool.query('DELETE FROM atarasy_member.control WHERE id=$1',[d]);}
  await pool.end();
 }
},60000);
