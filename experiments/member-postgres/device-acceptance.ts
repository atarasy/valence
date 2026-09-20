import {createPublicKey,generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import type {Store} from '../../engine/src/common/store.ts';
import {canonicalConfig} from '../../engine/src/engine/offers.ts';
import {canonicalDisclosure} from '../../engine/src/shared/disclosure.ts';
import {credentialSPKI} from '../member-login/credential-key.ts';
import {nameOf} from '../../engine/src/common/names.ts';
import {memberRuntimeIdentity,type MemberRuntimeConfig} from './config.ts';
import {memberRuntime} from './runtime.ts';
type Acceptance={principal:string;household:string|null;createdAt:number};
type StatementAcceptance={presenter:string;merchant:string;mandate:string;offer:string;credential:string;createdAt:number};
/**
 * The tool's own reasons, so the operator command can print them and nothing
 * else. A filter that guessed from a `code` property hid every engine refusal;
 * one that guessed from the constructor printed the driver's own text for the
 * failures `pg` raises as a plain `Error`. Both were measured.
 */
export class AcceptanceError extends Error {}
const DAY_MS=86_400_000;
// One acceptance box: the catalogue price below and the carriage recorded with
// it. §16.2's ceiling bounds the sum of unit price times quantity, and carriage
// is not in it, so the ceiling below is the price alone.
const ACCEPTANCE_PRICE=1200,ACCEPTANCE_CARRIAGE=550;
function checked(store:Store,c:MemberRuntimeConfig){
 const expected=memberRuntimeIdentity(c),bound=store.map<typeof expected>('member_config').get('current');
 if(c.environment!=='development'||!bound||bound.profile!==expected.profile||bound.fingerprint!==expected.fingerprint||memberRuntimeIdentity(bound.config).fingerprint!==expected.fingerprint)throw new AcceptanceError('Acceptance configuration unavailable');
 return store.map<Acceptance>('member_device_acceptance');
}
// A PostgreSQL unit opens each namespace once, so callers pass the acceptance map rather than reopening it.
function statementEntry(entries:ReturnType<typeof checked>){return entries.get('statement') as unknown as StatementAcceptance|undefined;}
/** Trusted operator capability. Not imported by the deployed HTTP entry. */
export function prepareDeviceAcceptance(store:Store,c:MemberRuntimeConfig){
 const entries=checked(store,c);if(entries.has('current'))throw new AcceptanceError('Acceptance already prepared; inspect status');
 // §13.2, question 55. The household's identifier is the name of the key its
 // statements are signed with, which here is the passkey the device registers,
 // so preparation cannot name a household: it is adopted at the first statement.
 const value:Acceptance={principal:'dev_member_'+randomUUID().replaceAll('-',''),household:null,createdAt:Date.now()};
 memberRuntime(store,c).authority.provisionUnclaimedPrincipal(value.principal,[]);
 entries.set('current',value);return value;
}
export function deviceAcceptanceStatus(store:Store,c:MemberRuntimeConfig){
 const entries=checked(store,c),value=entries.get('current');if(!value)return {prepared:false as const};
 const statement=statementEntry(entries),vox=entries.get('vox') as unknown as {presenter:string}|undefined;
 const grants=vox?[vox.presenter]:statement?[statement.presenter]:[];
 const principal=store.map<{household:string|null;presenters:string;disabled:number}>('member_principals').get(value.principal);
 if(!principal||principal.household!==value.household||principal.presenters!==JSON.stringify(grants)||principal.disabled!==0)throw new AcceptanceError('Acceptance principal changed or unavailable');
 const credentials=store.map<{principal:string;revoked:number}>('member_credentials');
 const base={prepared:true as const,...value,presenterGrants:grants.length,activeCredentials:[...credentials.values()].filter(v=>v.principal===value.principal&&v.revoked===0).length};
 if(!statement)return base;
 // Read the engine's settlement namespace directly: a full runtime would reopen the maps above.
 const settled=store.map('settlements').has(statement.offer);
 return {...base,statement:{presenter:statement.presenter,mandate:statement.mandate,offer:statement.offer,createdAt:statement.createdAt,settled}};
}
export function inviteDeviceAcceptance(store:Store,c:MemberRuntimeConfig){
 const value=checked(store,c).get('current');if(!value)throw new AcceptanceError('Acceptance not prepared');
 const r=memberRuntime(store,c);
 if(!r.authority.matchesActivePrincipalScope(value.principal,value.household,[]))throw new AcceptanceError('Acceptance principal changed or unavailable');
 return r.enrollment.issueInvitation(value.principal);
}
/**
 * One development presenter and merchant with a single-product catalogue, and
 * one delivered box whose goods the collection marked consumed. A presenter
 * may never offer a household the same product twice (§5.1), so every box
 * needs its own presenter. The keys are ephemeral: the catalogue and
 * disclosure are verified on registration and the private halves are dropped.
 */
async function presentBox(r:ReturnType<typeof memberRuntime>,household:string,mandate:string,at:number){
 const suffix=randomUUID().replaceAll('-','');
 const ids={presenter:'dev_presenter_'+suffix,merchant:'dev_merchant_'+suffix,product:'dev_goods_'+suffix};
 const presenterPair=generateKeyPairSync('ed25519'),merchantPair=generateKeyPairSync('ed25519');
 r.engine.registerIdentity(ids.presenter,presenterPair.publicKey.export({type:'spki',format:'pem'}).toString());
 r.engine.registerIdentity(ids.merchant,merchantPair.publicKey.export({type:'spki',format:'pem'}).toString());
 const config={version:'dev-acceptance-'+suffix,presenter:ids.presenter,products:{[ids.product]:{merchant:ids.merchant,maker:'dev_maker_'+suffix,ships:'dev_carrier_'+suffix,price:ACCEPTANCE_PRICE,physical:{ambient:true,keeps_for_days:365,fits_ten_per_container:true,regulated:false}}}};
 r.engine.registerConfig(config,sign(null,canonicalConfig(config),presenterPair.privateKey).toString('base64'));
 const disclosure={merchant:ids.merchant,product:null,version:'dev-acceptance-d1',items:[{label:'notice',value:'Development acceptance record. No goods are shipped and no payment is taken.'}]};
 r.engine.putDisclosure({...disclosure,signature:sign(null,canonicalDisclosure(disclosure),merchantPair.privateKey).toString('base64')});
 const offer=r.engine.createOffer({binding:'physical',household,purpose:'replenish',config_version:config.version,expires_at:at+DAY_MS,mandate,price_band:null,giver:null,candidates:[{product:ids.product,quantity:1,predicted_conversion:0.5,is_exploration:true,given_by:null}]});
 await r.engine.present(offer.id,at);
 r.deliveries.record({offer:offer.id,carriage:ACCEPTANCE_CARRIAGE,code:'dev-acceptance',status:'delivered',now:at});
 await r.engine.collect({offer:offer.id,consumed:offer.candidates.map(v=>v.id),returned:[],at});
 r.engine.applyRecoveryTo(offer.id,at);
 return {presenter:ids.presenter,merchant:ids.merchant,offer:offer.id};
}
/**
 * Trusted operator capability for statement approval on a device. Registers a
 * box as above under a mandate whose key is the passkey the device
 * registered. Nothing here signs for the household: the statement still needs
 * a native assertion from that passkey.
 */
export async function prepareStatementAcceptance(store:Store,c:MemberRuntimeConfig,now=Date.now){
 const entries=checked(store,c),value=entries.get('current');if(!value)throw new AcceptanceError('Acceptance not prepared');
 if(statementEntry(entries))throw new AcceptanceError('Statement acceptance already prepared; inspect status');
 const at=now(),r=memberRuntime(store,c,()=>at);
 if(!r.authority.matchesActivePrincipalScope(value.principal,value.household,[]))throw new AcceptanceError('Acceptance principal changed or unavailable');
 // One passkey only, so the mandate key cannot silently pick among devices,
 // and it must have signed once: a registration proves no key (§10.5). A step
 // that counted active credentials instead refused for ever as soon as one
 // device registered and did not sign in, with no command that cleared it.
 const {proven,unproven}=r.authority.credentialProof(value.principal);
 if(proven.length!==1||unproven.length!==0)throw new AcceptanceError(`Exactly one acceptance credential is required and it must have signed in; ${proven.length} have signed in and ${unproven.length} have not. Sign in on the device, or run \`retire\` and enrol it again.`);
 const credentials=proven;
 const credential=credentials[0]!,cose=r.login.verifiedPublicKey(credential);if(!cose)throw new AcceptanceError('Acceptance credential unavailable');
 // The key is registered under the household's own name, not the mandate's:
 // a mandate has no key, and its identifier is the household's with a label.
 // The authority reads the credential's key itself; nothing is named here.
 const household=value.household===null?r.authority.adoptHousehold(value.principal,credential):value.household;
 if(value.household===null)entries.set('current',{...value,household});
 else if(household!==nameOf(createPublicKey({key:credentialSPKI(cose),format:'der',type:'spki'}).export({type:'spki',format:'pem'}).toString()))throw new AcceptanceError('Acceptance household is not this credential');
 const mandate=household+'.1';
 r.engine.registerIdentity(household,createPublicKey({key:credentialSPKI(cose),format:'der',type:'spki'}).export({type:'spki',format:'pem'}).toString());
 // §16.1 and §14.2, question 56, decided 2026-09-18. **Nobody signs a mandate
 // here.** This step writes it as a claim, which is what an import writes, and
 // the device signs it through `/member/mandates/prepare` and `/submit` with
 // the passkey the household is named after. Until then no offer can name it,
 // so this step writes the claim and stops; run it again once the device has
 // signed and it presents the box.
 //
 // The ceiling below is one box's price. **It bounds nothing on this service**,
 // because `memberRuntime` supplies no registry and the engine then reads every
 // merchant as in network, so the out-of-network total is always zero: a second
 // pass set this field to 0 and the whole acceptance still ran. It is written
 // narrow so that it is right wherever it is read, not because it contains
 // anything here. The other three fields are the widest the shape allows and
 // are not narrowed: a cooling window would stop the acceptance settling, a
 // daily ceiling would stop the second box, and a co-signer is a key nobody
 // holds. **What the device signs is what it can read before it signs.**
 if(!r.engine.mandates.get(mandate)){
  r.engine.mandates.importMandate({id:mandate,household,ceiling_out_of_network:ACCEPTANCE_PRICE,ceiling_daily:null,cooling_seconds:null,co_signers:[],lapses_at:at+7*DAY_MS,version:1});
  return {household,mandate,awaitingSignature:true as const};
 }
 const box=await presentBox(r,household,mandate,at);
 // Changing grants revokes the device's current session; it signs in again afterwards.
 r.authority.setPresenterGrants(value.principal,[box.presenter]);
 r.authority.bindResource({kind:'mandate',id:mandate},{household});
 r.authority.bindResource({kind:'offer',id:box.offer},{household,presenter:box.presenter});
 // Binding derives its context from a live session. This one never leaves the locked unit and is revoked before commit.
 const internal=r.authority.createSessionAfterVerification(credential,at+60_000);
 try{r.bindings.bind(internal.token,mandate);}finally{r.authority.revokeSession(internal.id);}
 const record:StatementAcceptance={...box,mandate,credential,createdAt:at};
 entries.set('statement',record as unknown as Acceptance);
 return {household,presenter:box.presenter,mandate,offer:box.offer};
}
/**
 * Trusted operator capability for repeated device checks (lost responses,
 * offline approval). Adds one more box under the existing mandate and its
 * binding. It refuses while the latest box is unsettled, so at most one
 * statement waits. The grant moves to the new presenter, which revokes the
 * device's session: the device signs in again before it sees the box.
 */
export async function prepareStatementBox(store:Store,c:MemberRuntimeConfig,now=Date.now){
 const entries=checked(store,c),value=entries.get('current'),statement=statementEntry(entries);
 if(!value||!statement||value.household===null)throw new AcceptanceError('Statement acceptance not prepared');
 const household=value.household;
 // The engine owns the settlements map, and a PostgreSQL unit opens each namespace only once.
 const at=now(),r=memberRuntime(store,c,()=>at);
 if(!r.engine.settlement(statement.offer))throw new AcceptanceError('Latest acceptance box is not settled');
 if(!r.authority.matchesActivePrincipalScope(value.principal,value.household,[statement.presenter]))throw new AcceptanceError('Acceptance principal changed or unavailable');
 const box=await presentBox(r,household,statement.mandate,at);
 r.authority.setPresenterGrants(value.principal,[box.presenter]);
 r.authority.bindResource({kind:'offer',id:box.offer},{household,presenter:box.presenter});
 entries.set('statement',{...statement,...box,createdAt:at} as unknown as Acceptance);
 return {household,presenter:box.presenter,offer:box.offer};
}
/**
 * Trusted operator capability standing in for the household's own grant: lets
 * the acceptance household receive boxes from a Vox shop's presenter. Granting
 * is the household's act, so a presenter can never do this for itself. It
 * requires the latest operator box to be settled, so no statement is left
 * waiting under a presenter the household can no longer read, and it revokes
 * the device's session like any grant change.
 */
/**
 * Trusted operator capability that undoes the enrolment step. A registration
 * proves nothing (§10.5), so a device that enrols and does not sign in, or an
 * invitation used by the wrong party, leaves a credential the statement step
 * refuses to proceed past. This revokes **every** active credential of the
 * acceptance principal so the operator can invite again.
 *
 * It refuses once a statement exists, because by then a household has been
 * adopted from one of these keys and revoking is not what is wanted. Before
 * that, nothing has been adopted and no credential means anything, which is why
 * revoking all of them is safe and why leaving the proven one behind is not:
 * a fifth refutation pass measured a deployment with two signed-in credentials
 * that no command could leave.
 */
export function retireUnprovenCredentials(store:Store,c:MemberRuntimeConfig){
 const entries=checked(store,c),value=entries.get('current');if(!value)throw new AcceptanceError('Acceptance not prepared');
 if(statementEntry(entries))throw new AcceptanceError('Statement acceptance already prepared; inspect status');
 const r=memberRuntime(store,c);
 const {proven,unproven}=r.authority.credentialProof(value.principal);
 // Removed, not revoked: a revoked row keeps its id and its user handle, so the
 // same device could never enrol again, and the message this step prints tells
 // the operator to do exactly that.
 for(const id of [...proven,...unproven]){r.authority.removeCredential(id);r.login.removeEnrolledPasskey(id);}
 // What is in flight counts too: an invitation not yet spent, and a ceremony
 // opened and not finished, both become credentials after this returns.
 const cancelled=r.enrollment.cancelEnrolment(value.principal);
 return {retired:proven.length+unproven.length,signedIn:proven.length,unproven:unproven.length,cancelled};
}
export function grantVoxPresenter(store:Store,c:MemberRuntimeConfig,presenter:string,now=Date.now){
 const entries=checked(store,c),value=entries.get('current'),statement=statementEntry(entries);
 if(!value||!statement)throw new AcceptanceError('Statement acceptance not prepared');
 const r=memberRuntime(store,c,now);
 if(!r.engine.settlement(statement.offer))throw new AcceptanceError('Latest acceptance box is not settled');
 if(!r.engine.publicKeyFor(presenter))throw new AcceptanceError('Presenter identity not registered');
 if(entries.has('vox'))throw new AcceptanceError('A Vox presenter is already granted; inspect status');
 if(!r.authority.matchesActivePrincipalScope(value.principal,value.household,[statement.presenter]))throw new AcceptanceError('Acceptance principal changed or unavailable');
 r.authority.setPresenterGrants(value.principal,[presenter]);
 entries.set('vox',{presenter,createdAt:now()} as unknown as Acceptance);
 return {household:value.household,presenter,mandate:statement.mandate};
}
