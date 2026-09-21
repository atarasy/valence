import {createHash} from 'node:crypto';
import {MEMBER_WITHDRAWAL_PROFILE,memberWithdrawalBytes,type MemberWithdrawalEnvelope} from '../../engine/src/shared/member-withdrawal.ts';
import type {Offer} from '../../engine/src/common/types.ts';
import type {PreparedAssertion} from './login.ts';
import type {JournalOperation} from './operation-journal.ts';
import type {memberRuntime} from './runtime.ts';
import {openDecisionAuthorisations} from './decision-authorisation.ts';
function stable(v:unknown):string {
 if(v===null||typeof v!=='object')return JSON.stringify(v);
 if(Array.isArray(v))return '['+v.map(stable).join(',')+']';
 return '{'+Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>JSON.stringify(k)+':'+stable(x)).join(',')+'}';
}
const hash=(v:unknown)=>createHash('sha256').update(stable(v)).digest('hex');
function integer(v:number){if(!Number.isSafeInteger(v)||v<0)throw new Error('Invalid withdrawal time');}
function identifier(v:unknown):asserts v is string {if(typeof v!=='string'||!v||v.length>512||/[\u0000-\u001f\u007f]/.test(v))throw new Error('Invalid withdrawal identifier');}
type Input={decisionOperationID:string};
type Policy={environment:string;origin:string;rpID:string;maximumLifetimeMs:number;now?:()=>number};
/** Enclosing PostgreSQL unit owns all writes, including counter, engine and incarnation. */
export function openWithdrawalAuthorisations(r:ReturnType<typeof memberRuntime>,options:Policy){
 const p=Object.freeze({...options}),scope=r.engine.config.memberWithdrawalScope;
 if(!scope||scope.environment!==p.environment||scope.origin!==p.origin||r.engine.config.relyingPartyId!==p.rpID||r.authority.scope.environment!==p.environment||r.authority.scope.audience!==p.origin)throw new Error('Withdrawal scope mismatch');
 integer(p.maximumLifetimeMs);if(!p.maximumLifetimeMs)throw new Error('Positive lifetime required');
 const clock=()=>{const at=(p.now??Date.now)();integer(at);return at;};
 const decisions=openDecisionAuthorisations(r,p);
 function envelope(o:JournalOperation):MemberWithdrawalEnvelope {
  const {id,principal,credential,household,keyFingerprint,offer,mandate,presenter,canonical,reviewedRevision,expiresAt,requestDigest}=o;
  return {profile:MEMBER_WITHDRAWAL_PROFILE,environment:p.environment,origin:p.origin,rpID:p.rpID,id,principal,credential,household,keyFingerprint,offer,mandate,presenter,canonical,reviewedRevision,expiresAt,requestDigest};
 }
 const challenge=(o:JournalOperation)=>createHash('sha256').update(memberWithdrawalBytes(envelope(o))).digest('base64url');
 async function snapshot(token:string,input:Input){
  if(!input||Object.keys(input).join(',')!=='decisionOperationID')throw new Error('Invalid withdrawal input');identifier(input.decisionOperationID);
  const original=await r.journal.read(token,input.decisionOperationID),incarnation=r.journal.currentIncarnation(original.offer);
  if(original.kind!=='digital_decision'||original.state!=='committed'||(original.incarnation??0)!==incarnation)throw new Error('Current committed decision required');
  const outcome=await decisions.outcome(token,original.id),review=await decisions.read(token,original.id);
  const at=clock(),offer=r.engine.mustGet(original.offer,at),bound=r.bindings.resolve(token,offer.mandate);
  if(!outcome.decision||hash(outcome.decision)!==hash(offer))throw new Error('Original decision no longer current');
  const eligibility=await r.engine.memberWithdrawalEligibility(offer.id,at);
  if(eligibility.decisionRevision!==await decisions.withdrawalReference(token,original.id))throw new Error('Decision generation no longer current');
  const mandate=r.engine.mandates.get(offer.mandate);
  if(!mandate||mandate.household!==offer.household)throw new Error('Withdrawal mandate unavailable');
  const view=structuredClone({decisionOperationID:original.id,incarnation,offer,decisionReview:review.review,mandate,eligibility});
  const sealed={view,originalRequestDigest:original.requestDigest,originalReceiptDigest:original.receiptDigest};
  if(Buffer.byteLength(stable(sealed))>524288)throw new Error('Withdrawal snapshot too large');
  return {sealed,revision:hash(sealed),canonical:eligibility.canonical,bound};
 }
 type Result={decisionOperationID:string;nextIncarnation:number;offer:Offer};
 type Review={profile:typeof MEMBER_WITHDRAWAL_PROFILE;sealed:Awaited<ReturnType<typeof snapshot>>['sealed'];canonical:string;revision:string;challenge:string;verified:null|{fingerprint:string;counter:number;at:number};result:Result|null};
 function saved(o:JournalOperation):Review {
  const v=r.reviews.get(o.id) as Review|null;
  if(o.kind!=='digital_withdrawal'||!v||v.profile!==MEMBER_WITHDRAWAL_PROFILE||Object.keys(v).sort().join(',')!=='canonical,challenge,profile,result,revision,sealed,verified'||hash(v.sealed)!==o.reviewedRevision||v.revision!==o.reviewedRevision||v.canonical!==o.canonical||v.challenge!==challenge(o)||(o.incarnation??0)!==v.sealed.view.incarnation)throw new Error('Prepared withdrawal inconsistent');
  if(v.verified!==null){const proof=v.verified;if(Object.keys(proof).sort().join(',')!=='at,counter,fingerprint'||!/^[a-f0-9]{64}$/.test(proof.fingerprint))throw new Error('Invalid withdrawal proof');integer(proof.at);integer(proof.counter);if(proof.counter>0xffffffff||proof.at<o.createdAt||proof.at>=o.expiresAt)throw new Error('Invalid withdrawal proof');}
  if(o.state==='committed'){
   if(!v.result||v.result.offer.id!==o.offer||v.result.decisionOperationID!==v.sealed.view.decisionOperationID||v.result.nextIncarnation!==v.sealed.view.incarnation+1||hash(v.result)!==o.receiptDigest||v.verified?.fingerprint!==o.assertionFingerprint)throw new Error('Withdrawal outcome conflict');
  }else if(v.result!==null)throw new Error('Withdrawal outcome conflict');
  return v;
 }
 const response=(o:JournalOperation,v:Review)=>({profile:MEMBER_WITHDRAWAL_PROFILE,operationID:o.id,requestDigest:o.requestDigest,reviewedRevision:o.reviewedRevision,expiresAt:o.expiresAt,canonical:o.canonical,review:v.sealed.view,operationState:o.state,publicKey:{challenge:v.challenge,rpId:p.rpID,userVerification:'required' as const,allowCredentials:[{type:'public-key' as const,id:o.credential}]}});
 const outcome=(o:JournalOperation,v:Review)=>({operationID:o.id,operationState:o.state,withdrawal:v.result});
 return {
  async prepare(token:string,input:Input){
   const fresh=await snapshot(token,structuredClone(input));
   const previous=r.operations.findCurrent('digital_withdrawal',o=>o.offer===fresh.sealed.view.offer.id&&['prepared','dispatching','uncertain','committed'].includes(o.state));
   if(previous){const o=await r.journal.read(token,previous.id);if(o.state==='prepared'&&o.expiresAt<=clock())r.journal.refuseBeforeDispatch(o.id,'expired');else {const v=saved(o);if(o.state!=='prepared'||v.revision!==fresh.revision)throw new Error('Withdrawal review changed');return response(o,v);}}
   // A lapsed mandate or offer does not shorten a cooling right retained at decision.
   const expiresAt=Math.min(clock()+p.maximumLifetimeMs,fresh.bound.expiresAt,fresh.sealed.view.eligibility.coolingEndsAt);
   const o=await r.journal.prepare(token,{offer:fresh.sealed.view.offer.id,mandate:fresh.bound.binding.mandate,presenter:fresh.sealed.view.offer.presenter,canonical:fresh.canonical,reviewedRevision:fresh.revision,expiresAt},'digital_withdrawal');
   const v:Review={profile:MEMBER_WITHDRAWAL_PROFILE,sealed:fresh.sealed,canonical:fresh.canonical,revision:fresh.revision,challenge:challenge(o),verified:null,result:null};r.reviews.insert(o.id,v);return response(o,v);
  },
  async read(token:string,id:string){identifier(id);const o=await r.journal.read(token,id);return response(o,saved(o));},
  async outcome(token:string,id:string){identifier(id);const o=await r.journal.read(token,id);return outcome(o,saved(o));},
  async cancel(token:string,id:string){identifier(id);const o=await r.journal.read(token,id);saved(o);await r.journal.cancel(token,id);return {cancelled:true};},
  async submit(token:string,id:string,assertion:PreparedAssertion){
   identifier(id);const fixed=structuredClone(assertion),o=await r.journal.read(token,id),v=saved(o),fingerprint=hash(fixed);
   if(o.state==='committed'){if(o.assertionFingerprint!==fingerprint)throw new Error('Different authorisation');return outcome(o,v);}
   if(o.state!=='prepared'||o.expiresAt<=clock())throw new Error('Withdrawal unavailable');
   const fresh=await snapshot(token,{decisionOperationID:v.sealed.view.decisionOperationID});
   if(fresh.revision!==v.revision||fresh.canonical!==o.canonical)throw new Error('Withdrawal review changed');
   const verified=await r.login.verifyPreparedAssertion(o.credential,v.challenge,fixed);
   r.bindings.resolve(token,o.mandate);if(o.expiresAt<=clock())throw new Error('Withdrawal expired');
   const claimed=await r.journal.claimVerified(token,id,{requestDigest:o.requestDigest,reviewedRevision:o.reviewedRevision,assertionFingerprint:fingerprint});if(!claimed.acquired)throw new Error('Withdrawal unavailable');
   const result=await r.engine.withdrawMember(envelope(o),{authenticator_data:fixed.response.authenticatorData,client_data_json:fixed.response.clientDataJSON,signature:fixed.response.signature},clock());
   r.bindings.resolve(token,o.mandate);const committedAt=clock();if(o.expiresAt<=committedAt)throw new Error('Withdrawal expired');
   v.verified={fingerprint,counter:verified.counter,at:committedAt};v.result={decisionOperationID:v.sealed.view.decisionOperationID,nextIncarnation:v.sealed.view.incarnation+1,offer:structuredClone(result)};r.reviews.put(id,v);
   const committed=r.journal.recordCommitted(id,fingerprint,hash(v.result));
   if(r.journal.advanceAfterWithdrawal(token,v.result.decisionOperationID,id)!==v.result.nextIncarnation)throw new Error('Withdrawal incarnation conflict');
   return outcome(committed,v);
  },
 };
}
