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
const DAY_MS=86_400_000;
function checked(store:Store,c:MemberRuntimeConfig){
 const expected=memberRuntimeIdentity(c),bound=store.map<typeof expected>('member_config').get('current');
 if(c.environment!=='development'||!bound||bound.profile!==expected.profile||bound.fingerprint!==expected.fingerprint||memberRuntimeIdentity(bound.config).fingerprint!==expected.fingerprint)throw new Error('Acceptance configuration unavailable');
 return store.map<Acceptance>('member_device_acceptance');
}
// A PostgreSQL unit opens each namespace once, so callers pass the acceptance map rather than reopening it.
function statementEntry(entries:ReturnType<typeof checked>){return entries.get('statement') as unknown as StatementAcceptance|undefined;}
/** Trusted operator capability. Not imported by the deployed HTTP entry. */
export function prepareDeviceAcceptance(store:Store,c:MemberRuntimeConfig){
 const entries=checked(store,c);if(entries.has('current'))throw new Error('Acceptance already prepared; inspect status');
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
 if(!principal||principal.household!==value.household||principal.presenters!==JSON.stringify(grants)||principal.disabled!==0)throw new Error('Acceptance principal changed or unavailable');
 const credentials=store.map<{principal:string;revoked:number}>('member_credentials');
 const base={prepared:true as const,...value,presenterGrants:grants.length,activeCredentials:[...credentials.values()].filter(v=>v.principal===value.principal&&v.revoked===0).length};
 if(!statement)return base;
 // Read the engine's settlement namespace directly: a full runtime would reopen the maps above.
 const settled=store.map('settlements').has(statement.offer);
 return {...base,statement:{presenter:statement.presenter,mandate:statement.mandate,offer:statement.offer,createdAt:statement.createdAt,settled}};
}
export function inviteDeviceAcceptance(store:Store,c:MemberRuntimeConfig){
 const value=checked(store,c).get('current');if(!value)throw new Error('Acceptance not prepared');
 const r=memberRuntime(store,c);
 if(!r.authority.matchesActivePrincipalScope(value.principal,value.household,[]))throw new Error('Acceptance principal changed or unavailable');
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
 const config={version:'dev-acceptance-'+suffix,presenter:ids.presenter,products:{[ids.product]:{merchant:ids.merchant,maker:'dev_maker_'+suffix,ships:'dev_carrier_'+suffix,price:1200,physical:{ambient:true,keeps_for_days:365,fits_ten_per_container:true,regulated:false}}}};
 r.engine.registerConfig(config,sign(null,canonicalConfig(config),presenterPair.privateKey).toString('base64'));
 const disclosure={merchant:ids.merchant,product:null,version:'dev-acceptance-d1',items:[{label:'notice',value:'Development acceptance record. No goods are shipped and no payment is taken.'}]};
 r.engine.putDisclosure({...disclosure,signature:sign(null,canonicalDisclosure(disclosure),merchantPair.privateKey).toString('base64')});
 const offer=r.engine.createOffer({binding:'physical',household,purpose:'replenish',config_version:config.version,expires_at:at+DAY_MS,mandate,price_band:null,giver:null,candidates:[{product:ids.product,quantity:1,predicted_conversion:0.5,is_exploration:true,given_by:null}]});
 await r.engine.present(offer.id,at);
 r.deliveries.record({offer:offer.id,carriage:550,code:'dev-acceptance',status:'delivered',now:at});
 r.engine.collect({offer:offer.id,consumed:offer.candidates.map(v=>v.id),returned:[],at});
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
 const entries=checked(store,c),value=entries.get('current');if(!value)throw new Error('Acceptance not prepared');
 if(statementEntry(entries))throw new Error('Statement acceptance already prepared; inspect status');
 const at=now(),r=memberRuntime(store,c,()=>at);
 if(!r.authority.matchesActivePrincipalScope(value.principal,value.household,[]))throw new Error('Acceptance principal changed or unavailable');
 // One passkey only, so the mandate key cannot silently pick among devices.
 const credentials=r.authority.activeCredentialIDs(value.principal);if(credentials.length!==1)throw new Error('Exactly one active acceptance credential required');
 const credential=credentials[0]!,cose=r.login.verifiedPublicKey(credential);if(!cose)throw new Error('Acceptance credential unavailable');
 // The key is registered under the household's own name, not the mandate's:
 // a mandate has no key, and its identifier is the household's with a label.
 const pem=createPublicKey({key:credentialSPKI(cose),format:'der',type:'spki'}).export({type:'spki',format:'pem'}).toString();
 const household=nameOf(pem);
 if(value.household===null){r.authority.adoptHousehold(value.principal,household);entries.set('current',{...value,household});}
 else if(value.household!==household)throw new Error('Acceptance household is not this credential');
 const mandate=household+'.1';
 r.engine.registerIdentity(household,pem);
 r.engine.mandates.importMandate({id:mandate,household,ceiling_out_of_network:10000,ceiling_daily:null,cooling_seconds:null,co_signers:[],lapses_at:at+7*DAY_MS,version:1});
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
 if(!value||!statement||value.household===null)throw new Error('Statement acceptance not prepared');
 const household=value.household;
 // The engine owns the settlements map, and a PostgreSQL unit opens each namespace only once.
 const at=now(),r=memberRuntime(store,c,()=>at);
 if(!r.engine.settlement(statement.offer))throw new Error('Latest acceptance box is not settled');
 if(!r.authority.matchesActivePrincipalScope(value.principal,value.household,[statement.presenter]))throw new Error('Acceptance principal changed or unavailable');
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
export function grantVoxPresenter(store:Store,c:MemberRuntimeConfig,presenter:string,now=Date.now){
 const entries=checked(store,c),value=entries.get('current'),statement=statementEntry(entries);
 if(!value||!statement)throw new Error('Statement acceptance not prepared');
 const r=memberRuntime(store,c,now);
 if(!r.engine.settlement(statement.offer))throw new Error('Latest acceptance box is not settled');
 if(!r.engine.publicKeyFor(presenter))throw new Error('Presenter identity not registered');
 if(entries.has('vox'))throw new Error('A Vox presenter is already granted; inspect status');
 if(!r.authority.matchesActivePrincipalScope(value.principal,value.household,[statement.presenter]))throw new Error('Acceptance principal changed or unavailable');
 r.authority.setPresenterGrants(value.principal,[presenter]);
 entries.set('vox',{presenter,createdAt:now()} as unknown as Acceptance);
 return {household:value.household,presenter,mandate:statement.mandate};
}
