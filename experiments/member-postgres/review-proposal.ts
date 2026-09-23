import {createPublicKey,generateKeyPairSync,sign} from 'node:crypto';
import type {Store} from '../../engine/src/common/store.ts';
import {canonicalConfig} from '../../engine/src/engine/offers.ts';
import {canonicalDisclosure} from '../../engine/src/shared/disclosure.ts';
import {ApprovalDesk} from '../../engine/src/hub/approval.ts';
import {nameOf} from '../../engine/src/common/names.ts';
import {credentialSPKI} from '../member-login/credential-key.ts';
import type {MemberRuntimeConfig} from './config.ts';
import {memberRuntime} from './runtime.ts';
import {ReviewInvitationError,reviewPrincipals} from './review-invitation.ts';
const DAY_MS=86_400_000;
/**
 * The one review shop. Plain goods at plain prices; the digital binding ships
 * nothing, the carriage quote is zero and no provider is called, so a decision
 * on this proposal is an engine record and no money moves.
 */
export const REVIEW_SHOP={presenter:'app_review_shop',merchant:'app_review_merchant',version:'app-review-1'} as const;
export const REVIEW_GOODS={green_tea_50g:800,cotton_hand_towel:1200,beeswax_candle:1500} as const;
// An App Review can take days, so the proposal and the mandate outlive a development box by a wide margin.
const OFFER_DAYS=30,MANDATE_DAYS=90;
type Shop={presenter:string;merchant:string;version:string;registeredAt:number};
type Proposal={principal:string;household:string|null;mandate?:string;offer?:string;createdAt:number};
/**
 * Registered once per deployment. The keys are ephemeral: the catalogue and
 * disclosure are verified when they are registered and the private halves
 * are dropped, so nobody holds a key that could publish for this shop again.
 */
function reviewShop(r:ReturnType<typeof memberRuntime>,entries:Map<string,Proposal|Shop>,at:number):Shop{
 const held=entries.get('shop') as Shop|undefined;if(held)return held;
 const presenterPair=generateKeyPairSync('ed25519'),merchantPair=generateKeyPairSync('ed25519');
 r.engine.registerIdentity(REVIEW_SHOP.presenter,presenterPair.publicKey.export({type:'spki',format:'pem'}).toString());
 r.engine.registerIdentity(REVIEW_SHOP.merchant,merchantPair.publicKey.export({type:'spki',format:'pem'}).toString());
 const products=Object.fromEntries(Object.entries(REVIEW_GOODS).map(([product,price])=>[product,{merchant:REVIEW_SHOP.merchant,maker:'app_review_maker',ships:'app_review_carrier',price}]));
 const config={version:REVIEW_SHOP.version,presenter:REVIEW_SHOP.presenter,products};
 r.engine.registerConfig(config,sign(null,canonicalConfig(config),presenterPair.privateKey).toString('base64'));
 const disclosure={merchant:REVIEW_SHOP.merchant,product:null,version:'app-review-d1',items:[{label:'notice',value:'App Review proposal. Nothing is shipped and no payment is taken.'}]};
 r.engine.putDisclosure({...disclosure,signature:sign(null,canonicalDisclosure(disclosure),merchantPair.privateKey).toString('base64')});
 const shop:Shop={presenter:REVIEW_SHOP.presenter,merchant:REVIEW_SHOP.merchant,version:REVIEW_SHOP.version,registeredAt:at};
 entries.set('shop',shop);return shop;
}
/**
 * Trusted operator capability for App Review on the production deployment.
 * Not imported by the deployed HTTP entry. It acts only on a principal that
 * `issueReviewInvitation` issued, never on a member who joined otherwise.
 *
 * Run twice, as the development `statement` step is. A household is the name
 * of its key (§13.2, question 55), and the key is the passkey the reviewer's
 * device registered, so the first run adopts the household from that one
 * signed-in credential and writes the mandate as a **claim**, which has no
 * effect (§16.1, question 56). The reviewer's device signs the claim through
 * `/member/mandates/prepare` and `/submit`. The second run registers the
 * review shop if this deployment has none, grants it to the principal and
 * presents one digital proposal of three goods under that signed mandate.
 * Nothing here signs for the household.
 */
export async function proposeForReview(store:Store,c:MemberRuntimeConfig,principal:string,now=Date.now){
 const issued=reviewPrincipals(store,c);
 if(!issued.has(principal))throw new ReviewInvitationError('Not a review principal');
 const entries=store.map<Proposal|Shop>('member_review_proposals'),key='principal:'+principal;
 const held=(entries.get(key) as Proposal|undefined)??{principal,household:null,createdAt:now()};
 if(held.offer)throw new ReviewInvitationError('A review proposal is already presented to this principal');
 const at=now(),r=memberRuntime(store,c,()=>at);
 if(!r.authority.matchesActivePrincipalScope(principal,held.household,[]))throw new ReviewInvitationError('Review principal changed or unavailable');
 // One passkey, and it must have signed: a registration alone proves no key (§10.5).
 const {proven,unproven}=r.authority.credentialProof(principal);
 if(proven.length!==1||unproven.length!==0)throw new ReviewInvitationError(`Exactly one review credential is required and it must have signed in; ${proven.length} have signed in and ${unproven.length} have not`);
 const credential=proven[0]!,cose=r.login.verifiedPublicKey(credential);if(!cose)throw new ReviewInvitationError('Review credential unavailable');
 const pem=createPublicKey({key:credentialSPKI(cose),format:'der',type:'spki'}).export({type:'spki',format:'pem'}).toString();
 const household=held.household??r.authority.adoptHousehold(principal,credential);
 if(household!==nameOf(pem))throw new ReviewInvitationError('Review household is not this credential');
 const mandate=household+'.1';
 r.engine.registerIdentity(household,pem);
 if(!r.engine.mandates.get(mandate)){
  if(!r.engine.mandates.claimFor(mandate,at)){
   const ceiling=Object.values(REVIEW_GOODS).reduce((a,b)=>a+b,0);
   r.engine.mandates.importMandate({id:mandate,household,ceiling_out_of_network:ceiling,ceiling_daily:null,cooling_seconds:null,co_signers:[],lapses_at:at+MANDATE_DAYS*DAY_MS,version:1});
  }
  entries.set(key,{...held,household,mandate});
  return {household,mandate,awaitingSignature:true as const};
 }
 const shop=reviewShop(r,entries,at);
 const offer=r.engine.createOffer({binding:'digital',household,purpose:'replenish',config_version:shop.version,expires_at:at+OFFER_DAYS*DAY_MS,mandate,price_band:null,giver:null,candidates:Object.keys(REVIEW_GOODS).map(product=>({product,quantity:1,predicted_conversion:null,is_exploration:true,given_by:null}))});
 await r.engine.present(offer.id,at);
 const lapses=r.engine.mandates.get(mandate)!.lapses_at;
 new ApprovalDesk(store).record({offer:offer.id,perCandidate:Object.fromEntries(offer.candidates.map(v=>[v.id,{alternatives:['Keep using what you already have'],argument_against:'You may not need this yet.'}])),excluded:[],mandate:{kind:'standing',scope:mandate,lapses_at:lapses}});
 r.quotes.record(offer.id,0,at);
 // Changing grants revokes the device's current session; it signs in again afterwards.
 r.authority.setPresenterGrants(principal,[shop.presenter]);
 r.authority.bindResource({kind:'mandate',id:mandate},{household});
 r.authority.bindResource({kind:'offer',id:offer.id},{household,presenter:shop.presenter});
 // Binding derives its context from a live session. This one never leaves the locked unit and is revoked before commit.
 const internal=r.authority.createSessionAfterVerification(credential,at+60_000);
 try{r.bindings.bind(internal.token,mandate);}finally{r.authority.revokeSession(internal.id);}
 entries.set(key,{...held,household,mandate,offer:offer.id});
 return {household,mandate,presenter:shop.presenter,offer:offer.id};
}
