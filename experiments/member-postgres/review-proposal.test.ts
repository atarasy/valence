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
import {ValenceEngine} from '../../engine/src/engine/offers.ts';
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

test('a repeating failure while presenting the review proposal never rolls back the member\'s signature; the fallback presents it once presenting works again',async()=>{
 const url=process.env.ATARASY_TEST_POSTGRES_URL;if(!url)throw new Error('Isolated PostgreSQL URL required');
 const c=TARGETS.production.config;
 const id={id:'reviewfail_'+randomUUID().replaceAll('-',''),environment:c.environment,origin:c.origin,epoch:1};
 const pool=createPool(url),unit=postgresStore(pool,id);
 try{
  await migrateDatabase(url);await initialiseDeployment(pool,id);const app=await openPostgresMemberHTTP(pool,id,c);
  const send=(path:string,body?:unknown,token?:string)=>app.fetch(new Request(c.origin+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),{peer:'review-fail-test'});
  const invitation=await unit.run(s=>issueReviewInvitation(s,c));
  const flow=await (await send('/auth/enrollment/options',{invitation:invitation.token})).json(),key=syntheticAuthenticator();
  expect((await send('/auth/enrollment/verify',{id:flow.id,response:key.register(flow.publicKey.challenge,c.origin,c.rpID)})).status).toBe(201);
  const handle=flow.publicKey.user.id;
  const f=await (await send('/auth/login/options',{})).json();
  const signed=await send('/auth/login/verify',{id:f.id,response:key.authenticate(f.publicKey.challenge,c.origin,c.rpID,handle,1)});
  expect(signed.status).toBe(200);const token=(await signed.json()).token as string;
  const session=await (await send('/auth/session',undefined,token)).json();
  const household=session.household as string,mandate=household+'.1';

  // The signature is made to succeed and the presentation that follows it made
  // to fail every time, the same fault the refuter injected: `present` throws.
  const original=ValenceEngine.prototype.present;
  ValenceEngine.prototype.present=async function(){throw new Error('synthetic present failure')} as typeof original;
  try{
   const named=await (await send('/member/mandates/prepare',{mandate},token)).json();
   const submitted=await send('/member/mandates/submit',{assertion:assertionFor(key,named.publicKey.challenge,c,2),mandate},token);
   // The signature still commits and the member sees success, even though presenting kept failing.
   expect(submitted.status).toBe(200);
   const body=await submitted.json();expect(body.id).toBe(mandate);expect(body.version).toBe(1);
   // Nothing was presented: the failure never reached the client, but it also never wrote an offer.
   const offers=await (await send('/offers?household='+encodeURIComponent(household)+'&presenter='+REVIEW_SHOP.presenter,undefined,token)).json();
   expect(offers.offers).toEqual([]);
   // The mandate itself is genuinely signed, independent of the presenting failure.
   expect(await unit.run(s=>memberRuntime(s,c).engine.mandates.get(mandate)?.version)).toBe(1);
  }finally{ValenceEngine.prototype.present=original;}

  // Presenting works again. The fallback presents exactly once.
  const first=await unit.run(s=>proposeForReview(s,c,household));
  expect(first).toMatchObject({household,mandate,presented:true});
  const offer=(first as {offer:string}).offer;
  const second=await unit.run(s=>proposeForReview(s,c,household));
  expect(second).toMatchObject({offer,presented:false});
  const list=await (await send('/offers?household='+encodeURIComponent(household)+'&presenter='+REVIEW_SHOP.presenter,undefined,token)).json();
  expect(list.offers).toHaveLength(1);
 }finally{
  await pool.query('DELETE FROM atarasy_member.engine_rows WHERE deployment=$1',[id.id]);await pool.query('DELETE FROM atarasy_member.control WHERE id=$1',[id.id]);
  await pool.end();
 }
},60000);

test('a stranded reviewer is presented on the next offers read or the next sign-in, at most once even under concurrent triggers',async()=>{
 const url=process.env.ATARASY_TEST_POSTGRES_URL;if(!url)throw new Error('Isolated PostgreSQL URL required');
 const c=TARGETS.production.config;
 const id={id:'reviewretry_'+randomUUID().replaceAll('-',''),environment:c.environment,origin:c.origin,epoch:1};
 const pool=createPool(url),unit=postgresStore(pool,id);
 try{
  await migrateDatabase(url);await initialiseDeployment(pool,id);const app=await openPostgresMemberHTTP(pool,id,c);
  const send=(path:string,body?:unknown,token?:string)=>app.fetch(new Request(c.origin+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),{peer:'review-retry-test'});
  const invitation=await unit.run(s=>issueReviewInvitation(s,c));
  const flow=await(await send('/auth/enrollment/options',{invitation:invitation.token})).json(),key=syntheticAuthenticator();
  expect((await send('/auth/enrollment/verify',{id:flow.id,response:key.register(flow.publicKey.challenge,c.origin,c.rpID)})).status).toBe(201);
  const handle=flow.publicKey.user.id;
  const signIn=async(counter:number)=>{
   const f=await(await send('/auth/login/options',{})).json();
   const reply=await send('/auth/login/verify',{id:f.id,response:key.authenticate(f.publicKey.challenge,c.origin,c.rpID,handle,counter)});
   expect(reply.status).toBe(200);return (await reply.json()).token as string;
  };
  const offersOf=(token:string)=>send('/offers?household='+encodeURIComponent(household)+'&presenter='+REVIEW_SHOP.presenter,undefined,token).then(r=>r.json());
  const token=await signIn(1);
  const session=await(await send('/auth/session',undefined,token)).json();
  const household=session.household as string,mandate=household+'.1';

  // Sign and submit while presenting is broken, exactly as the test above,
  // so the reviewer is left with a signed mandate and no proposal.
  const original=ValenceEngine.prototype.present;
  ValenceEngine.prototype.present=async function(){throw new Error('synthetic present failure')} as typeof original;
  try{
   const named=await(await send('/member/mandates/prepare',{mandate},token)).json();
   const submitted=await send('/member/mandates/submit',{assertion:assertionFor(key,named.publicKey.challenge,c,2),mandate},token);
   expect(submitted.status).toBe(200);
   expect((await offersOf(token)).offers).toEqual([]);
  }finally{ValenceEngine.prototype.present=original;}

  // Presenting works again, and nothing has retried yet. Fire three triggers
  // at once: two reads of the offers list and a second sign-in. Every
  // deployment-wide unit serialises on the control row, so exactly one of
  // these retries wins the race to present; the rest find `held.offer`
  // already set and do nothing. Each trigger's own response reflects the
  // state before its own retry ran (the retry is a separate, later
  // transaction), so none of these three responses is asserted on directly.
  const [signedInAgain]=await Promise.all([signIn(3),offersOf(token),offersOf(token)]);
  expect(typeof signedInAgain).toBe('string');
  const finalList=await offersOf(token);
  expect(finalList.offers).toHaveLength(1);
  const detail=await (await send('/offers/'+finalList.offers[0].id,undefined,token)).json();
  expect(detail.state).toBe('presented');expect(detail.binding).toBe('digital');
  // A further read presents nothing more: the gate is `held.offer`, not a one-shot flag.
  expect((await offersOf(token)).offers).toHaveLength(1);
 }finally{
  await pool.query('DELETE FROM atarasy_member.engine_rows WHERE deployment=$1',[id.id]);await pool.query('DELETE FROM atarasy_member.control WHERE id=$1',[id.id]);
  await pool.end();
 }
},60000);
