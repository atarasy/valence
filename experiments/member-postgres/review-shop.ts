import {generateKeyPairSync,sign} from 'node:crypto';
import {canonicalConfig} from '../../engine/src/engine/offers.ts';
import {canonicalDisclosure} from '../../engine/src/shared/disclosure.ts';
import {ApprovalDesk} from '../../engine/src/hub/approval.ts';
import type {Mandate} from '../../engine/src/hub/mandates.ts';
import type {memberRuntime} from './runtime.ts';
type Runtime=ReturnType<typeof memberRuntime>;
const DAY_MS=86_400_000;
/**
 * The one review shop for App Review. Plain goods at plain prices; the digital
 * binding ships nothing, the carriage quote is zero and no provider is called,
 * so a decision on its proposal is an engine record and no money moves.
 */
export const REVIEW_SHOP={presenter:'app_review_shop',merchant:'app_review_merchant',version:'app-review-1'} as const;
export const REVIEW_GOODS={green_tea_50g:800,cotton_hand_towel:1200,beeswax_candle:1500} as const;
// App Review can take days, so the proposal stays open well past a development box.
const OFFER_DAYS=30;
export type ReviewShop={presenter:string;merchant:string;version:string;registeredAt:number};
export type ReviewProposal={principal:string;household:string;offer?:string;createdAt:number;presentedAt?:number};
/**
 * Registered once per deployment. The keys are ephemeral: the catalogue and
 * disclosure are verified when they are registered and the private halves are
 * dropped, so nobody holds a key that could publish for this shop again.
 */
export function reviewShop(r:Runtime,at:number):ReviewShop{
 const held=r.reviewProposals.get('shop') as ReviewShop|null;if(held)return held;
 const presenterPair=generateKeyPairSync('ed25519'),merchantPair=generateKeyPairSync('ed25519');
 r.engine.registerIdentity(REVIEW_SHOP.presenter,presenterPair.publicKey.export({type:'spki',format:'pem'}).toString());
 r.engine.registerIdentity(REVIEW_SHOP.merchant,merchantPair.publicKey.export({type:'spki',format:'pem'}).toString());
 const products=Object.fromEntries(Object.entries(REVIEW_GOODS).map(([product,price])=>[product,{merchant:REVIEW_SHOP.merchant,maker:'app_review_maker',ships:'app_review_carrier',price}]));
 const config={version:REVIEW_SHOP.version,presenter:REVIEW_SHOP.presenter,products};
 r.engine.registerConfig(config,sign(null,canonicalConfig(config),presenterPair.privateKey).toString('base64'));
 const disclosure={merchant:REVIEW_SHOP.merchant,product:null,version:'app-review-d1',items:[{label:'notice',value:'App Review proposal. Nothing is shipped and no payment is taken.'}]};
 r.engine.putDisclosure({...disclosure,signature:sign(null,canonicalDisclosure(disclosure),merchantPair.privateKey).toString('base64')});
 const shop:ReviewShop={presenter:REVIEW_SHOP.presenter,merchant:REVIEW_SHOP.merchant,version:REVIEW_SHOP.version,registeredAt:at};
 r.reviewProposals.put('shop',shop);return shop;
}
/**
 * At adoption, and only for a principal `member-invite.ts` issued for review:
 * grant the review shop there and then. The grant is made before the sign-in's
 * session exists, so it revokes nothing and the reviewer's session survives
 * everything that follows. Every other principal is left exactly as it was.
 */
export function grantReviewShop(r:Runtime,principal:string,household:string,at:number){
 if(!r.reviewPrincipals.get(principal))return;
 const shop=reviewShop(r,at);
 r.authority.setPresenterGrants(principal,[shop.presenter]);
 r.reviewProposals.insertIfAbsent('principal:'+principal,{principal,household,createdAt:at});
}
/**
 * One digital proposal of the three goods, under the household's signed
 * version-1 mandate. `bind` associates that mandate with the reviewer's
 * credential, which a decision needs; it is given a live session by the
 * caller, because a binding derives its context from one.
 */
export async function presentReviewProposal(r:Runtime,principal:string,mandate:Mandate,at:number,bind:()=>void){
 const key='principal:'+principal,held=r.reviewProposals.get(key) as ReviewProposal|null;
 if(!held||held.household!==mandate.household)throw new Error('Not a review household');
 if(held.offer)return {household:held.household,mandate:mandate.id,presenter:REVIEW_SHOP.presenter,offer:held.offer,presented:false as const};
 const shop=reviewShop(r,at),household=held.household;
 const offer=r.engine.createOffer({binding:'digital',household,purpose:'replenish',config_version:shop.version,expires_at:at+OFFER_DAYS*DAY_MS,mandate:mandate.id,price_band:null,giver:null,candidates:Object.keys(REVIEW_GOODS).map(product=>({product,quantity:1,predicted_conversion:null,is_exploration:true,given_by:null}))});
 await r.engine.present(offer.id,at);
 new ApprovalDesk(r.path.store).record({offer:offer.id,perCandidate:Object.fromEntries(offer.candidates.map(v=>[v.id,{alternatives:['Keep using what you already have'],argument_against:'You may not need this yet.'}])),excluded:[],mandate:{kind:'standing',scope:mandate.id,lapses_at:mandate.lapses_at}});
 r.quotes.record(offer.id,0,at);
 r.authority.bindResource({kind:'mandate',id:mandate.id},{household});
 r.authority.bindResource({kind:'offer',id:offer.id},{household,presenter:shop.presenter});
 bind();
 // Last, because a grant that changes revokes the principal's sessions and the binding above reads one.
 // It is unchanged whenever adoption already granted the shop, which is every reviewer after this change.
 r.authority.setPresenterGrants(principal,[shop.presenter]);
 r.reviewProposals.put(key,{...held,offer:offer.id,presentedAt:at});
 return {household,mandate:mandate.id,presenter:shop.presenter,offer:offer.id,presented:true as const};
}
/**
 * Called by the member mandate route after a signature is recorded. For a
 * review principal whose household has just signed its version-1 mandate, the
 * proposal is presented in the same request, because App Review happens at an
 * unknown hour and nobody can run a command between the reviewer's steps.
 * Anybody else signing anything is untouched.
 */
export async function presentAfterSigning(r:Runtime,token:string,signed:Mandate,at:number){
 const who=r.authority.sessionPrincipal(token);
 if(!who||!r.reviewPrincipals.get(who.principal)||signed.id!==who.household+'.1'||signed.household!==who.household)return;
 // Only a household this module recorded at adoption. Anything else is left to the operator fallback rather than
 // refused here, because a refusal would roll back the signature the member just made.
 const held=r.reviewProposals.get('principal:'+who.principal) as ReviewProposal|null;
 if(!held||held.household!==who.household||held.offer)return;
 await presentReviewProposal(r,who.principal,signed,at,()=>{r.bindings.bind(token,signed.id);});
}
