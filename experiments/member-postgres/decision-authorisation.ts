import { createHash } from 'node:crypto';
import { MEMBER_DECISION_PROFILE, memberDecisionBytes, type MemberDecisionEnvelope } from '../../engine/src/shared/member-decision.ts';
import { canonicalDecisions, type DecisionInput } from '../../engine/src/shared/decisions.ts';
import { verifyDisclosure } from '../../engine/src/shared/disclosure.ts';
import { ApprovalDesk } from '../../engine/src/hub/approval.ts';
import type { Offer } from '../../engine/src/common/types.ts';
import type { PreparedAssertion } from './login.ts';
import type { JournalOperation } from './operation-journal.ts';
import type { memberRuntime } from './runtime.ts';

function stable(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  return '{' + Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>JSON.stringify(k)+':'+stable(x)).join(',') + '}';
}
const hash=(v:unknown)=>createHash('sha256').update(stable(v)).digest('hex');
function integer(v:number){if(!Number.isSafeInteger(v)||v<0)throw new Error('Invalid decision amount or time');}
function identifier(v:unknown):asserts v is string{if(typeof v!=='string'||!v||v.length>512||/[\u0000-\u001f\u007f]/.test(v))throw new Error('Invalid decision identifier');}
type Input={offer:string;decisions:DecisionInput[]};
type Policy={environment:string;origin:string;rpID:string;maximumLifetimeMs:number;now?:()=>number};

/** Must run inside the enclosing postgresStore transaction; no provider or remote side effects. */
export function openDecisionAuthorisations(r:ReturnType<typeof memberRuntime>, options:Policy){
  const p=Object.freeze({...options}),scope=r.engine.config.memberDecisionScope;
  if(!scope||scope.environment!==p.environment||scope.origin!==p.origin||r.engine.config.relyingPartyId!==p.rpID||r.authority.scope.environment!==p.environment||r.authority.scope.audience!==p.origin)throw new Error('Decision scope mismatch');
  integer(p.maximumLifetimeMs);if(!p.maximumLifetimeMs)throw new Error('Positive lifetime required');
  const clock=()=>{const at=(p.now??Date.now)();integer(at);return at;};
  const approvals=new ApprovalDesk(r.path.store);
  function envelope(o:JournalOperation):MemberDecisionEnvelope{
    const {id,principal,credential,household,keyFingerprint,offer,mandate,presenter,canonical,reviewedRevision,expiresAt,requestDigest}=o;
    return {profile:MEMBER_DECISION_PROFILE,environment:p.environment,origin:p.origin,rpID:p.rpID,id,principal,credential,household,keyFingerprint,offer,mandate,presenter,canonical,reviewedRevision,expiresAt,requestDigest};
  }
  const challenge=(o:JournalOperation)=>createHash('sha256').update(memberDecisionBytes(envelope(o))).digest('base64url');
  function snapshot(token:string,input:Input){
    if(!input||Object.keys(input).sort().join(',')!=='decisions,offer')throw new Error('Invalid decision input');
    identifier(input.offer);
    const at=clock(),offer=r.engine.mustGet(input.offer,at),bound=r.bindings.resolve(token,offer.mandate),owner=r.authority.transactionOfferOwner(offer.id);
    if(!owner||owner.household!==bound.binding.household||offer.household!==owner.household||owner.presenter!==offer.presenter||!bound.presenters.includes(offer.presenter))throw new Error('Decision unavailable');
    if(offer.binding!=='digital'||offer.state!=='presented'||offer.expires_at<=at||r.engine.settlement(offer.id))throw new Error('Decision unavailable');
    if(!Array.isArray(input.decisions)||!input.decisions.length||input.decisions.length>1000||input.decisions.length!==offer.candidates.length||new Set(input.decisions.map(d=>d.candidate)).size!==offer.candidates.length)throw new Error('Complete choices required');
    for(const d of input.decisions){
      if(!d||typeof d!=='object'||Array.isArray(d)||Object.keys(d).sort().join(',')!==(d.valence==='kept'?'candidate,kept_as,valence':'candidate,valence'))throw new Error('Invalid choice');
      identifier(d.candidate);
      if(!['kept','returned'].includes(d.valence)||(d.valence==='kept'&&d.kept_as!=='self')||!offer.candidates.some(c=>c.id===d.candidate&&c.valence==='offered'))throw new Error('Invalid choice');
    }
    const mandate=r.engine.mandates.mustGet(offer.mandate,at);
    if(mandate.household!==offer.household||mandate.lapses_at<=at)throw new Error('Mandate unavailable');
    const catalogue=r.engine.configsForPresenter(offer.presenter).find(c=>c.version===offer.config_version);
    if(!catalogue)throw new Error('Catalogue unavailable');
    const delivery=r.deliveries.find(offer.id);
    if(!delivery)throw new Error('Carriage unavailable');integer(delivery.carriage);
    const approval=approvals.render(r.engine,offer,delivery);
    if('missing' in approval)throw new Error('Deliberation unavailable');
    if(!['standing','individual'].includes(approval.mandate.kind)||!approval.mandate.scope.trim()||
      (approval.mandate.kind==='standing'&&approval.mandate.lapses_at===null))throw new Error('Invalid deliberation mandate');
    if(approval.mandate.lapses_at!==null){integer(approval.mandate.lapses_at);if(approval.mandate.lapses_at<=at)throw new Error('Deliberation mandate expired');}
    if(approval.candidates.some(c=>c.alternatives.some(a=>!a.trim())||!c.argument_against.trim()))throw new Error('Invalid deliberation');
    let goods=0;
    for(const c of offer.candidates){
      integer(c.unit_price);integer(c.quantity);integer(c.unit_price*c.quantity);if(!c.quantity)throw new Error('Invalid quantity');
      const entry=catalogue.products[c.product];
      if(!entry||entry.price!==c.unit_price||entry.merchant!==c.merchant||entry.maker!==c.maker||entry.ships!==c.ships)throw new Error('Catalogue changed');
      if(!offer.disclosures.some(d=>d.merchant===c.merchant&&d.product===null))throw new Error('Disclosure missing');
      if(!c.given_by&&input.decisions.find(d=>d.candidate===c.id)!.valence==='kept')goods+=c.unit_price*c.quantity;
      integer(goods);
    }
    for(const d of offer.disclosures){const key=r.engine.publicKeyFor(d.merchant);if(!key||!verifyDisclosure(d,key))throw new Error('Disclosure invalid');}
    integer(goods+delivery.carriage);
    const decisions=[...input.decisions].sort((a,b)=>a.candidate<b.candidate?-1:a.candidate>b.candidate?1:0);
    const view={approval,mandate:structuredClone(mandate),decisions,goods,carriage:delivery.carriage,total:goods+delivery.carriage};
    const sealed=structuredClone({offer,catalogue,delivery,view});
    if(Buffer.byteLength(stable(sealed))>262144)throw new Error('Decision snapshot too large');
    return {sealed,canonical:canonicalDecisions(offer.id,decisions).toString(),revision:hash(sealed),bound};
  }
  type Review={profile:typeof MEMBER_DECISION_PROFILE;sealed:ReturnType<typeof snapshot>['sealed'];canonical:string;revision:string;challenge:string;verified:null|{fingerprint:string;counter:number;at:number};result:Offer|null};
  function saved(o:JournalOperation):Review{
    const value=r.reviews.get(o.id) as Review|null;
    if(o.kind!=='digital_decision'||!value||value.profile!==MEMBER_DECISION_PROFILE||Object.keys(value).sort().join(',')!=='canonical,challenge,profile,result,revision,sealed,verified'||hash(value.sealed)!==o.reviewedRevision||value.revision!==o.reviewedRevision||value.canonical!==o.canonical||value.challenge!==challenge(o))throw new Error('Prepared decision inconsistent');
    if(value.verified!==null){const proof=value.verified;if(Object.keys(proof).sort().join(',')!=='at,counter,fingerprint'||!/^[a-f0-9]{64}$/.test(proof.fingerprint))throw new Error('Invalid decision proof');integer(proof.at);integer(proof.counter);if(proof.counter>0xffffffff||proof.at<o.createdAt||proof.at>=o.expiresAt)throw new Error('Invalid decision proof');}
    if(o.state==='committed'){
      if(!value.result||value.result.id!==o.offer||hash(value.result)!==o.receiptDigest||value.verified?.fingerprint!==o.assertionFingerprint)throw new Error('Decision outcome conflict');
    }else if(value.result!==null)throw new Error('Decision outcome conflict');
    return value;
  }
  function response(o:JournalOperation,v:Review){return {profile:MEMBER_DECISION_PROFILE,operationID:o.id,requestDigest:o.requestDigest,reviewedRevision:o.reviewedRevision,expiresAt:o.expiresAt,canonical:o.canonical,review:v.sealed.view,operationState:o.state,publicKey:{challenge:v.challenge,rpId:p.rpID,userVerification:'required' as const,allowCredentials:[{type:'public-key' as const,id:o.credential}]}};}
  function outcome(o:JournalOperation,v:Review){return {operationID:o.id,operationState:o.state,decision:v.result};}
  return {
    async prepare(token:string,input:Input){
      const fixed=structuredClone(input),fresh=snapshot(token,fixed);
      const previous=r.operations.find(o=>o.offer===fixed.offer&&['prepared','dispatching','uncertain','committed'].includes(o.state));
      if(previous){
        const old=await r.journal.read(token,previous.id);
        if(old.state==='prepared'&&old.expiresAt<=clock())r.journal.refuseBeforeDispatch(old.id,'expired');
        else{const v=saved(old);if(old.state!=='prepared'||v.revision!==fresh.revision||v.canonical!==fresh.canonical)throw new Error('Review changed');return response(old,v);}
      }
      const expiresAt=Math.min(clock()+p.maximumLifetimeMs,fresh.bound.expiresAt,fresh.sealed.view.mandate.lapses_at,fresh.sealed.offer.expires_at,fresh.sealed.view.approval.mandate.lapses_at??Number.MAX_SAFE_INTEGER);
      const o=await r.journal.prepare(token,{offer:fixed.offer,mandate:fresh.bound.binding.mandate,presenter:fresh.sealed.offer.presenter,canonical:fresh.canonical,reviewedRevision:fresh.revision,expiresAt},'digital_decision');
      const v:Review={profile:MEMBER_DECISION_PROFILE,sealed:fresh.sealed,canonical:fresh.canonical,revision:fresh.revision,challenge:challenge(o),verified:null,result:null};
      r.reviews.insert(o.id,v);return response(o,v);
    },
    async read(token:string,id:string){identifier(id);const o=await r.journal.read(token,id);return response(o,saved(o));},
    async outcome(token:string,id:string){identifier(id);const o=await r.journal.read(token,id);return outcome(o,saved(o));},
    async cancel(token:string,id:string){identifier(id);const o=await r.journal.read(token,id);saved(o);await r.journal.cancel(token,id);return {cancelled:true};},
    async submit(token:string,id:string,assertion:PreparedAssertion){
      identifier(id);const fixed=structuredClone(assertion),o=await r.journal.read(token,id),v=saved(o),fingerprint=hash(fixed);
      if(o.state==='committed'){if(o.assertionFingerprint!==fingerprint)throw new Error('Different authorisation');return outcome(o,v);}
      if(o.state!=='prepared'||o.expiresAt<=clock())throw new Error('Authorisation unavailable');
      const fresh=snapshot(token,{offer:o.offer,decisions:v.sealed.view.decisions});
      if(fresh.revision!==v.revision||fresh.canonical!==o.canonical)throw new Error('Review changed');
      const verified=await r.login.verifyPreparedAssertion(o.credential,v.challenge,fixed);
      r.bindings.resolve(token,o.mandate);if(o.expiresAt<=clock())throw new Error('Authorisation expired');
      v.verified={fingerprint,counter:verified.counter,at:clock()};
      const claimed=await r.journal.claimVerified(token,id,{requestDigest:o.requestDigest,reviewedRevision:o.reviewedRevision,assertionFingerprint:fingerprint});
      if(!claimed.acquired)throw new Error('Decision outcome unavailable');
      const result=await r.engine.decideMember(envelope(o),v.sealed.view.decisions,{authenticator_data:fixed.response.authenticatorData,client_data_json:fixed.response.clientDataJSON,signature:fixed.response.signature},clock());
      r.bindings.resolve(token,o.mandate);if(o.expiresAt<=clock())throw new Error('Authorisation expired');
      v.result=structuredClone(result);r.reviews.put(id,v);
      const committed=r.journal.recordCommitted(id,fingerprint,hash(v.result));
      return outcome(committed,v);
    },
  };
}
