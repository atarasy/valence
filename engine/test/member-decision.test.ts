import { expect, test } from 'bun:test';
import { createHash, sign } from 'node:crypto';
import { MEMBER_DECISION_PROFILE, memberDecisionBytes, type MemberDecisionEnvelope } from '../src/shared/member-decision.js';
import { canonicalDecisions, type Assertion, type DecisionInput } from '../src/shared/decisions.js';
import { makeEngine, HOUSEHOLD, MANDATE, MANDATE_PAIR, CONFIG_VERSION, HOUR } from './helpers.js';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const scope = { environment: 'test', origin: 'https://unit.example' };
function digest(e: MemberDecisionEnvelope) {
  return hash(JSON.stringify(['atarasy.member-decision-operation.1', JSON.stringify([1,e.environment,e.origin]),e.principal,e.credential,e.household,e.keyFingerprint,e.offer,e.mandate,e.presenter,e.canonical,e.reviewedRevision,e.expiresAt]));
}
function assertion(e: MemberDecisionEnvelope, options: { origin?: string; flags?: number; bytes?: Buffer } = {}): Assertion {
  const auth = Buffer.concat([createHash('sha256').update(e.rpID).digest(),Buffer.from([options.flags ?? 5,0,0,0,1])]);
  const client = Buffer.from(JSON.stringify({type:'webauthn.get',origin:options.origin ?? e.origin,challenge:createHash('sha256').update(options.bytes ?? memberDecisionBytes(e)).digest('base64url')}));
  return {authenticator_data:auth.toString('base64url'),client_data_json:client.toString('base64url'),signature:sign(null,Buffer.concat([auth,createHash('sha256').update(client).digest()]),MANDATE_PAIR.privateKey).toString('base64url')};
}
async function setup(binding: 'digital'|'physical' = 'digital', enabled = true) {
  const config = { relyingPartyId:'unit.example', ...(enabled ? {memberDecisionScope:scope} : {}) };
  const {engine,ledger}=makeEngine(config), now=Date.now();
  const offer=engine.createOffer({binding,household:HOUSEHOLD,purpose:'replenish',config_version:CONFIG_VERSION,expires_at:now+HOUR,mandate:MANDATE,price_band:null,giver:null,candidates:[{product:'tea-a',quantity:1,predicted_conversion:null,is_exploration:true,given_by:null},{product:'tea-b',quantity:1,predicted_conversion:null,is_exploration:false,given_by:null}]});
  await engine.present(offer.id,now);
  const decisions: DecisionInput[]=offer.candidates.map((c,i)=>i===0?{candidate:c.id,valence:'kept',kept_as:'self'}:{candidate:c.id,valence:'returned'});
  const envelope: MemberDecisionEnvelope={profile:MEMBER_DECISION_PROFILE,environment:scope.environment,origin:scope.origin,rpID:'unit.example',id:'operation-1',principal:'principal',credential:'credential',household:HOUSEHOLD,keyFingerprint:hash(MANDATE_PAIR.publicKey.export({type:'spki',format:'der'})),offer:offer.id,mandate:MANDATE,presenter:offer.presenter,canonical:canonicalDecisions(offer.id,decisions).toString(),reviewedRevision:hash('frozen review'),expiresAt:now+60000,requestDigest:''};
  envelope.requestDigest=digest(envelope);
  return {engine,ledger,offer,decisions,envelope,now};
}

test('contextual digital decision records explicit keep/refusal and rejects ordinary-route replay',async()=>{
  const s=await setup(),a=assertion(s.envelope);
  await expect(s.engine.decide(s.offer.id,s.decisions,a,s.now)).rejects.toThrow('signature');
  const result=await s.engine.decideMember(s.envelope,s.decisions,a,s.now);
  expect(result.state).toBe('decided');
  expect(result.candidates.map(c=>c.valence)).toEqual(['kept','returned']);
  expect(result.candidates[0]!.kept_as).toBe('self');
  await expect(s.engine.decideMember(s.envelope,s.decisions,a,s.now)).rejects.toThrow('cannot decide');
});

test('deployment opt-in and physical/digital boundary cannot be crossed',async()=>{
  for(const [binding,enabled] of [['physical',true],['digital',false]] as const){
    const s=await setup(binding,enabled);
    await expect(s.engine.decideMember(s.envelope,s.decisions,assertion(s.envelope),s.now)).rejects.toThrow();
    expect(s.engine.mustGet(s.offer.id,s.now).state).toBe('presented');
  }
});

test('every candidate requires one explicit supported choice',async()=>{
  for(const mutate of [
    (d:DecisionInput[])=>d.slice(0,1),
    (d:DecisionInput[])=>[d[0]!,d[0]!],
    (d:DecisionInput[])=>[{...d[0]!,candidate:'foreign'},d[1]!],
    (d:DecisionInput[])=>[{...d[0]!,kept_as:'order' as const},d[1]!],
    (d:DecisionInput[])=>[{...d[0]!,lineage:'edge'},d[1]!],
  ]){
    const s=await setup(),decisions=mutate(s.decisions);
    s.envelope.canonical=canonicalDecisions(s.offer.id,decisions).toString();s.envelope.requestDigest=digest(s.envelope);
    await expect(s.engine.decideMember(s.envelope,decisions,assertion(s.envelope),s.now)).rejects.toThrow();
    expect(s.engine.mustGet(s.offer.id,s.now).candidates.every(c=>c.valence==='offered')).toBe(true);
  }
});

test('tampered signed context cannot change authority or terms',async()=>{
  for(const [field,value] of Object.entries({environment:'other',origin:'https://elsewhere.example',rpID:'elsewhere.example',id:'operation-2',principal:'other',credential:'other',household:'other',keyFingerprint:hash('other key'),offer:'other-offer',mandate:'other',presenter:'other',canonical:'other',reviewedRevision:hash('other review'),expiresAt:1,requestDigest:hash('other request'),profile:'atarasy.member-statement-authorisation.1'})){
    const s=await setup(),proof=assertion(s.envelope),changed={...s.envelope,[field]:value};
    await expect(s.engine.decideMember(changed as MemberDecisionEnvelope,s.decisions,proof,s.now)).rejects.toThrow();
    expect(s.engine.mustGet(s.offer.id,s.now).state).toBe('presented');
  }
});

test('legacy challenges, foreign origins, absent UV and expired signed envelopes fail',async()=>{
  for(const options of [{bytes:Buffer.from('legacy')},{origin:'https://elsewhere.example'},{flags:1}]){
    const s=await setup();
    await expect(s.engine.decideMember(s.envelope,s.decisions,assertion(s.envelope,options),s.now)).rejects.toThrow('signature');
    expect(s.engine.mustGet(s.offer.id,s.now).state).toBe('presented');
  }
  const s=await setup();s.envelope.expiresAt=s.now;s.envelope.requestDigest=digest(s.envelope);
  await expect(s.engine.decideMember(s.envelope,s.decisions,assertion(s.envelope),s.now)).rejects.toThrow('signature');
});
