import {expect,test} from 'bun:test';
import {createHash,sign} from 'node:crypto';
import {MEMBER_WITHDRAWAL_PROFILE,memberWithdrawalBytes,type MemberWithdrawalEnvelope} from '../src/shared/member-withdrawal.js';
import {canonicalWithdrawal,canonicalDecisions,type DecisionInput,type Assertion} from '../src/shared/decisions.js';
import {canonicalMandate} from '../src/hub/mandates.js';
import {makeEngine,HOUSEHOLD,MANDATE,MANDATE_PAIR,CONFIG_VERSION,HOUR} from './helpers.js';
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const androidOrigin=`android:apk-key-hash:${Buffer.alloc(32,7).toString('base64url')}`;
const scope={environment:'test',origin:'https://unit.example',androidAppOrigins:[androidOrigin]};
function digest(e:MemberWithdrawalEnvelope){return hash(JSON.stringify(['atarasy.member-withdrawal-operation.1',JSON.stringify([1,e.environment,e.origin]),e.principal,e.credential,e.household,e.keyFingerprint,e.offer,e.mandate,e.presenter,e.canonical,e.reviewedRevision,e.expiresAt]));}
function assertion(e:MemberWithdrawalEnvelope,options:{origin?:string;flags?:number;bytes?:Buffer}={}):Assertion {
 const auth=Buffer.concat([createHash('sha256').update(e.rpID).digest(),Buffer.from([options.flags??5,0,0,0,1])]);
 const client=Buffer.from(JSON.stringify({type:'webauthn.get',origin:options.origin??e.origin,challenge:createHash('sha256').update(options.bytes??memberWithdrawalBytes(e)).digest('base64url')}));
 return {authenticator_data:auth.toString('base64url'),client_data_json:client.toString('base64url'),signature:sign(null,Buffer.concat([auth,createHash('sha256').update(client).digest()]),MANDATE_PAIR.privateKey).toString('base64url')};
}
async function decideAt(engine:ReturnType<typeof makeEngine>['engine'],id:string,choices:DecisionInput[],now:number){
 return engine.decide(id,choices,sign(null,canonicalDecisions(id,choices),MANDATE_PAIR.privateKey).toString('base64'),now);
}
async function setup(enabled=true,cooling:number|null=3600,binding:'digital'|'physical'='digital'){
 const config={relyingPartyId:'unit.example',...(enabled?{memberWithdrawalScope:scope}:{})},made=makeEngine(config),{engine}=made,now=Date.now();
 const mandate={id:MANDATE,household:HOUSEHOLD,ceiling_out_of_network:100000,ceiling_daily:null,cooling_seconds:cooling,co_signers:[],lapses_at:now+HOUR*24,version:1};
 engine.mandates.record({mandate,signatures:{[HOUSEHOLD]:sign(null,canonicalMandate(mandate,'unit.example'),MANDATE_PAIR.privateKey).toString('base64')},assertions:{},keyOf:k=>engine.publicKeyFor(k),relyingPartyId:'unit.example',now});
 const offer=engine.createOffer({binding,household:HOUSEHOLD,purpose:'replenish',config_version:CONFIG_VERSION,expires_at:now+HOUR,mandate:MANDATE,price_band:null,giver:null,candidates:[{product:'tea-a',quantity:1,predicted_conversion:null,is_exploration:true,given_by:null}]});
 await engine.present(offer.id,now);
 await decideAt(engine,offer.id,[{candidate:offer.candidates[0]!.id,valence:'kept',kept_as:'self'}],now);
 const canonical=binding==='digital'?engine.memberWithdrawalReview(offer.id,now).canonical:'invalid physical';
 const envelope:MemberWithdrawalEnvelope={profile:MEMBER_WITHDRAWAL_PROFILE,environment:scope.environment,origin:scope.origin,rpID:'unit.example',id:'withdrawal-1',principal:'member',credential:'credential',household:HOUSEHOLD,keyFingerprint:hash(MANDATE_PAIR.publicKey.export({type:'spki',format:'der'})),offer:offer.id,mandate:MANDATE,presenter:offer.presenter,canonical,reviewedRevision:hash('reviewed decision'),expiresAt:now+60000,requestDigest:''};envelope.requestDigest=digest(envelope);
 return {...made,offer,envelope,now};
}
test('contextual withdrawal resets only a signed digital set and cannot use the legacy route',async()=>{
 const s=await setup(),a=assertion(s.envelope);
 await expect(s.engine.withdrawDecisions(s.offer.id,{assertion:a},s.now)).rejects.toThrow('signature');
 const result=await s.engine.withdrawMember(s.envelope,a,s.now);
 expect(result.state).toBe('presented');expect(result.decided_at).toBeNull();expect(result.candidates[0]!.valence).toBe('offered');
 await expect(s.engine.withdrawMember(s.envelope,a,s.now)).rejects.toThrow('cannot withdraw');
});
test('a new decision at the same millisecond is a different withdrawal generation',async()=>{
 const s=await setup(),first=s.engine.memberWithdrawalReview(s.offer.id,s.now),proof=assertion(s.envelope);
 await s.engine.withdrawMember(s.envelope,proof,s.now);
 // Identical choices at the identical time, but a new passkey assertion.
 const choices:DecisionInput[]=[{candidate:s.offer.candidates[0]!.id,valence:'kept',kept_as:'self'}];
 await s.engine.decide(s.offer.id,choices,assertion(s.envelope,{bytes:canonicalDecisions(s.offer.id,choices)}),s.now);
 const second=s.engine.memberWithdrawalReview(s.offer.id,s.now);
 expect(second.decidedAt).toBe(first.decidedAt);expect(second.decisionRevision).not.toBe(first.decisionRevision);
 await expect(s.engine.withdrawMember(s.envelope,proof,s.now)).rejects.toThrow('signature');
 expect(s.engine.mustGet(s.offer.id,s.now).state).toBe('decided');
 const next={...s.envelope,id:'withdrawal-2',canonical:second.canonical,reviewedRevision:hash('new review')};next.requestDigest=digest(next);
 expect((await s.engine.withdrawMember(next,assertion(next),s.now)).state).toBe('presented');
});
test('scope opt-in, digital binding and the current generation are mandatory',async()=>{
 const disabled=await setup(false);await expect(disabled.engine.withdrawMember(disabled.envelope,assertion(disabled.envelope),disabled.now)).rejects.toThrow('signature');
 const physical=await setup(true,3600,'physical');await expect(physical.engine.withdrawMember(physical.envelope,assertion(physical.envelope),physical.now)).rejects.toThrow('digital');
 const s=await setup();for(const canonical of [canonicalWithdrawal(s.offer.id,s.now).toString(),s.envelope.canonical+'changed']){
  const e={...s.envelope,canonical};e.requestDigest=digest(e);await expect(s.engine.withdrawMember(e,assertion(e),s.now)).rejects.toThrow('signature');
 }
});
test('tampered withdrawal context cannot change authority or reviewed terms',async()=>{
 const s=await setup(),a=assertion(s.envelope);
 for(const [field,value]of Object.entries({profile:'atarasy.member-decision-authorisation.1',environment:'other',origin:'https://elsewhere.example',rpID:'elsewhere.example',id:'other',principal:'other',credential:'other',household:'other',keyFingerprint:hash('other'),offer:'other',mandate:'other',presenter:'other',canonical:'other',reviewedRevision:hash('other'),expiresAt:1,requestDigest:hash('other')})){
  await expect(s.engine.withdrawMember({...s.envelope,[field]:value} as MemberWithdrawalEnvelope,a,s.now)).rejects.toThrow();
  expect(s.engine.mustGet(s.offer.id,s.now).state).toBe('decided');
 }
});
test('foreign origin, missing verification, legacy challenge and expired envelope fail',async()=>{
 const s=await setup();for(const options of [{origin:'https://foreign.example'},{flags:1},{bytes:canonicalWithdrawal(s.offer.id,s.now)}]){
  await expect(s.engine.withdrawMember(s.envelope,assertion(s.envelope,options),s.now)).rejects.toThrow('signature');
 }
 const expired={...s.envelope,expiresAt:s.now};expired.requestDigest=digest(expired);
 await expect(s.engine.withdrawMember(expired,assertion(expired),s.now)).rejects.toThrow('signature');
 expect(s.engine.mustGet(s.offer.id,s.now).state).toBe('decided');
});
test('contextual authorisation never bypasses cooling or settlement finality',async()=>{
 const none=await setup(true,null);await expect(none.engine.withdrawMember(none.envelope,assertion(none.envelope),none.now)).rejects.toThrow('no cooling');
 const closed=await setup(true,1);await expect(closed.engine.withdrawMember(closed.envelope,assertion(closed.envelope),closed.now+1000)).rejects.toThrow('closed');
 const settled=await setup(true,0);await settled.engine.settle(settled.offer.id,settled.now);
 await expect(settled.engine.withdrawMember(settled.envelope,assertion(settled.envelope),settled.now)).rejects.toThrow('cannot withdraw');
});
test('a pinned Android signing origin authorises withdrawal and an unlisted certificate does not',async()=>{
 const accepted=await setup();expect((await accepted.engine.withdrawMember(accepted.envelope,assertion(accepted.envelope,{origin:androidOrigin}),accepted.now)).state).toBe('presented');
 const rejected=await setup();await expect(rejected.engine.withdrawMember(rejected.envelope,assertion(rejected.envelope,{origin:`android:apk-key-hash:${Buffer.alloc(32,8).toString('base64url')}`}),rejected.now)).rejects.toThrow('signature');
});
