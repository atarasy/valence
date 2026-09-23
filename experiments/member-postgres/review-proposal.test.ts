import {test,expect} from 'bun:test';
import {randomUUID} from 'node:crypto';
import {createPool,initialiseDeployment,postgresStore} from './store.ts';
import {migrateDatabase} from './migrate.ts';
import {openPostgresMemberHTTP} from './http.ts';
import {memberRuntime} from './runtime.ts';
import {issueReviewInvitation} from './review-invitation.ts';
import {proposeForReview} from './review-proposal.ts';
import {REVIEW_GOODS,REVIEW_SHOP} from './review-shop.ts';
import {TARGETS} from './deployment/targets.ts';
import {syntheticAuthenticator} from '../member-login/fixtures/authenticator.ts';
import type {MemberRuntimeConfig} from './config.ts';
// §10.5. The mandate ceremony reads an assertion's three fields as base64; the synthetic authenticator speaks base64url.
const assertionFor=(key:ReturnType<typeof syntheticAuthenticator>,challenge:string,c:MemberRuntimeConfig,counter:number)=>{
 const r=key.authenticate(challenge,c.origin,c.rpID,'',counter).response as {clientDataJSON:string;authenticatorData:string;signature:string};
 const b64=(v:string)=>Buffer.from(v,'base64url').toString('base64');
 return {client_data_json:b64(r.clientDataJSON),authenticator_data:b64(r.authenticatorData),signature:b64(r.signature)};
};
test('a review household is granted the review shop at its first sign-in and sees the proposal as soon as it signs its mandate, in the same session; an ordinary member is untouched',async()=>{
 const url=process.env.ATARASY_TEST_POSTGRES_URL;if(!url)throw new Error('Isolated PostgreSQL URL required');
 const c=TARGETS.production.config,dev=TARGETS.development.config;
 const id={id:'review_'+randomUUID().replaceAll('-',''),environment:c.environment,origin:c.origin,epoch:1};
 const devID={id:'reviewdev_'+randomUUID().replaceAll('-',''),environment:dev.environment,origin:dev.origin,epoch:1};
 const pool=createPool(url),unit=postgresStore(pool,id);
 try{
  await migrateDatabase(url);await initialiseDeployment(pool,id);const app=await openPostgresMemberHTTP(pool,id,c);
  const send=(path:string,body?:unknown,token?:string)=>app.fetch(new Request(c.origin+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),{peer:'review-test'});
  const join=async(invitation:{token:string})=>{
   const flow=await (await send('/auth/enrollment/options',{invitation:invitation.token})).json(),key=syntheticAuthenticator();
   expect((await send('/auth/enrollment/verify',{id:flow.id,response:key.register(flow.publicKey.challenge,c.origin,c.rpID)})).status).toBe(201);
   const handle=flow.publicKey.user.id;
   const signIn=async(counter:number)=>{const f=await (await send('/auth/login/options',{})).json();const reply=await send('/auth/login/verify',{id:f.id,response:key.authenticate(f.publicKey.challenge,c.origin,c.rpID,handle,counter)});expect(reply.status).toBe(200);return (await reply.json()).token as string;};
   return {key,signIn,handle};
  };
  // Only production, and the invitation lives its own fourteen days.
  await initialiseDeployment(pool,devID);await openPostgresMemberHTTP(pool,devID,dev);
  await expect(postgresStore(pool,devID).run(s=>issueReviewInvitation(s,dev))).rejects.toThrow('Review configuration unavailable');
  const invitation=await unit.run(s=>issueReviewInvitation(s,c));
  expect(invitation.expiresAt-Date.now()).toBeGreaterThan(c.invitationLifetimeMs-60_000);

  // An ordinary member on the same deployment, for the comparison.
  await unit.run(s=>{memberRuntime(s,c).authority.provisionUnclaimedPrincipal('ordinary_member',[]);});
  const ordinary=await join(await unit.run(s=>memberRuntime(s,c).enrollment.issueInvitation('ordinary_member')));
  const ordinaryToken=await ordinary.signIn(1);
  const ordinarySession=await (await send('/auth/session',undefined,ordinaryToken)).json();
  expect(ordinarySession.presenters).toEqual([]);

  const reviewer=await join(invitation);
  const token=await reviewer.signIn(1);
  // Adopted at sign-in and granted the review shop before the session existed.
  const session=await (await send('/auth/session',undefined,token)).json();
  expect(session.presenters).toEqual([REVIEW_SHOP.presenter]);
  const household=session.household as string,mandate=household+'.1';
  // The operator fallback answers awaitingSignature until the mandate is signed, and refuses an ordinary household.
  expect(await unit.run(s=>proposeForReview(s,c,household))).toEqual({household,mandate,awaitingSignature:true,claimHeld:true});
  await expect(unit.run(s=>proposeForReview(s,c,ordinarySession.household))).rejects.toThrow('Not a review household');
  expect((await (await send('/offers?household='+encodeURIComponent(household)+'&presenter='+REVIEW_SHOP.presenter,undefined,token)).json()).offers).toEqual([]);

  // The reviewer signs the claim; the same request presents the proposal.
  const named=await (await send('/member/mandates/prepare',{mandate},token)).json();
  expect(named.mandate.id).toBe(mandate);
  expect((await send('/member/mandates/submit',{assertion:assertionFor(reviewer.key,named.publicKey.challenge,c,2),mandate},token)).status).toBe(200);
  // No second sign-in: the same session reads the proposal.
  expect((await send('/auth/session',undefined,token)).status).toBe(200);
  const list=await (await send('/offers?household='+encodeURIComponent(household)+'&presenter='+REVIEW_SHOP.presenter,undefined,token)).json();
  expect(list.offers).toHaveLength(1);
  const offer=list.offers[0].id as string;
  const detail=await (await send('/offers/'+offer,undefined,token)).json();
  expect(detail.binding).toBe('digital');expect(detail.state).toBe('presented');
  expect(detail.candidates.map((v:{product:string})=>v.product).sort()).toEqual(Object.keys(REVIEW_GOODS).sort());
  // The fallback now reports the proposal already there and presents nothing new.
  expect(await unit.run(s=>proposeForReview(s,c,household))).toMatchObject({offer,presented:false});
  // The reviewer keeps one line and returns the rest. Carriage is zero and no provider exists to call.
  const decisions=detail.candidates.map((v:{id:string},i:number)=>i===0?{candidate:v.id,valence:'kept',kept_as:'self'}:{candidate:v.id,valence:'returned'});
  const prepared=await send('/member/decisions/prepare',{offer,decisions},token);expect(prepared.status).toBe(200);
  const p=await prepared.json();expect(p.review.carriage).toBe(0);
  const submitted=await send('/member/operations/'+p.operationID+'/submit',{assertion:reviewer.key.authenticate(p.publicKey.challenge,c.origin,c.rpID,reviewer.handle,3)},token);
  expect(submitted.status).toBe(200);const result=await submitted.json();
  expect(result.operationState).toBe('committed');expect(result.decision.state).toBe('decided');expect(result.receipt).toBeUndefined();

  // The ordinary member signs its own claim and nothing is presented or granted to it.
  const ordinaryNamed=await (await send('/member/mandates/prepare',{mandate:ordinarySession.household+'.1'},ordinaryToken)).json();
  expect((await send('/member/mandates/submit',{assertion:assertionFor(ordinary.key,ordinaryNamed.publicKey.challenge,c,2),mandate:ordinarySession.household+'.1'},ordinaryToken)).status).toBe(200);
  const ordinaryAfter=await send('/auth/session',undefined,ordinaryToken);
  expect(ordinaryAfter.status).toBe(200);expect((await ordinaryAfter.json()).presenters).toEqual([]);
  expect(await unit.run(s=>memberRuntime(s,c).reviewProposals.find(v=>(v as {household?:string}).household===ordinarySession.household))).toBeNull();
 }finally{
  for(const d of [id.id,devID.id]){await pool.query('DELETE FROM atarasy_member.engine_rows WHERE deployment=$1',[d]);await pool.query('DELETE FROM atarasy_member.control WHERE id=$1',[d]);}
  await pool.end();
 }
},60000);
