import {createPublicKey,generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import type {Store} from '../../engine/src/common/store.ts';
import {canonicalConfig} from '../../engine/src/engine/offers.ts';
import {canonicalDisclosure} from '../../engine/src/shared/disclosure.ts';
import {credentialSPKI} from '../member-login/credential-key.ts';
import {memberRuntimeIdentity,type MemberRuntimeConfig} from './config.ts';
import {memberRuntime} from './runtime.ts';
type Acceptance={principal:string;household:string;createdAt:number};
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
 const value={principal:'dev_member_'+randomUUID().replaceAll('-',''),household:'dev_house_'+randomUUID().replaceAll('-',''),createdAt:Date.now()};
 memberRuntime(store,c).authority.provisionPrincipal(value.principal,value.household,[]);
 entries.set('current',value);return value;
}
export function deviceAcceptanceStatus(store:Store,c:MemberRuntimeConfig){
 const entries=checked(store,c),value=entries.get('current');if(!value)return {prepared:false as const};
 const statement=statementEntry(entries),grants=statement?[statement.presenter]:[];
 const principal=store.map<{household:string;presenters:string;disabled:number}>('member_principals').get(value.principal);
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
 * Trusted operator capability for statement approval on a device. Registers a
 * development presenter, merchant, catalogue and one physical box whose
 * collection is already recorded, under a mandate whose key is the passkey the
 * device registered. Nothing here signs for the household: the statement
 * still needs a native assertion from that passkey.
 */
export async function prepareStatementAcceptance(store:Store,c:MemberRuntimeConfig,now=Date.now){
 const entries=checked(store,c),value=entries.get('current');if(!value)throw new Error('Acceptance not prepared');
 if(statementEntry(entries))throw new Error('Statement acceptance already prepared; inspect status');
 const at=now(),r=memberRuntime(store,c,()=>at);
 if(!r.authority.matchesActivePrincipalScope(value.principal,value.household,[]))throw new Error('Acceptance principal changed or unavailable');
 // One passkey only, so the mandate key cannot silently pick among devices.
 const credentials=r.authority.activeCredentialIDs(value.principal);if(credentials.length!==1)throw new Error('Exactly one active acceptance credential required');
 const credential=credentials[0]!,cose=r.login.verifiedPublicKey(credential);if(!cose)throw new Error('Acceptance credential unavailable');
 const mandateKey=createPublicKey({key:credentialSPKI(cose),format:'der',type:'spki'}).export({type:'spki',format:'pem'}).toString();
 const suffix=randomUUID().replaceAll('-','');
 const ids={presenter:'dev_presenter_'+suffix,merchant:'dev_merchant_'+suffix,mandate:'dev_mandate_'+suffix,product:'dev_goods_'+suffix};
 // Ephemeral keys: the catalogue and disclosure are verified once on registration and the private halves are dropped.
 const presenterPair=generateKeyPairSync('ed25519'),merchantPair=generateKeyPairSync('ed25519');
 r.engine.registerIdentity(ids.presenter,presenterPair.publicKey.export({type:'spki',format:'pem'}).toString());
 r.engine.registerIdentity(ids.merchant,merchantPair.publicKey.export({type:'spki',format:'pem'}).toString());
 r.engine.registerIdentity(ids.mandate,mandateKey);
 const config={version:'dev-acceptance-'+suffix,presenter:ids.presenter,products:{[ids.product]:{merchant:ids.merchant,maker:'dev_maker_'+suffix,ships:'dev_carrier_'+suffix,price:1200,physical:{ambient:true,keeps_for_days:365,fits_ten_per_container:true,regulated:false}}}};
 r.engine.registerConfig(config,sign(null,canonicalConfig(config),presenterPair.privateKey).toString('base64'));
 const disclosure={merchant:ids.merchant,product:null,version:'dev-acceptance-d1',items:[{label:'notice',value:'Development acceptance record. No goods are shipped and no payment is taken.'}]};
 r.engine.putDisclosure({...disclosure,signature:sign(null,canonicalDisclosure(disclosure),merchantPair.privateKey).toString('base64')});
 r.engine.mandates.importMandate({id:ids.mandate,household:value.household,ceiling_out_of_network:10000,ceiling_daily:null,cooling_seconds:null,co_signers:[],lapses_at:at+7*DAY_MS,version:1});
 const offer=r.engine.createOffer({binding:'physical',household:value.household,purpose:'replenish',config_version:config.version,expires_at:at+DAY_MS,mandate:ids.mandate,price_band:null,giver:null,candidates:[{product:ids.product,quantity:1,predicted_conversion:0.5,is_exploration:true,given_by:null}]});
 await r.engine.present(offer.id,at);
 r.deliveries.record({offer:offer.id,carriage:550,code:'dev-acceptance',status:'delivered',now:at});
 r.engine.recoveries.collect({offer:offer.id,consumed:offer.candidates.map(v=>v.id),returned:[],at});
 r.engine.applyRecoveryTo(offer.id,at);
 // Changing grants revokes the device's current session; it signs in again afterwards.
 r.authority.setPresenterGrants(value.principal,[ids.presenter]);
 r.authority.bindResource({kind:'mandate',id:ids.mandate},{household:value.household});
 r.authority.bindResource({kind:'offer',id:offer.id},{household:value.household,presenter:ids.presenter});
 // Binding derives its context from a live session. This one never leaves the locked unit and is revoked before commit.
 const internal=r.authority.createSessionAfterVerification(credential,at+60_000);
 try{r.bindings.bind(internal.token,ids.mandate);}finally{r.authority.revokeSession(internal.id);}
 const record:StatementAcceptance={presenter:ids.presenter,merchant:ids.merchant,mandate:ids.mandate,offer:offer.id,credential,createdAt:at};
 entries.set('statement',record as unknown as Acceptance);
 return {household:value.household,presenter:ids.presenter,mandate:ids.mandate,offer:offer.id};
}
