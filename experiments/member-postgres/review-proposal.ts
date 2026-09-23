import type {Store} from '../../engine/src/common/store.ts';
import type {MemberRuntimeConfig} from './config.ts';
import {ReviewInvitationError,reviewRuntime} from './review-invitation.ts';
import {REVIEW_SHOP,presentReviewProposal,type ReviewProposal} from './review-shop.ts';
/**
 * The operator fallback for App Review. Not imported by the deployed HTTP
 * entry, and not needed on the ordinary path: the reviewer's first sign-in
 * adopts the household and grants the review shop, and signing the version-1
 * mandate presents the proposal in the same request (review-shop.ts).
 *
 * Given a household a review principal adopted, it answers `awaitingSignature`
 * until that household has signed its version-1 mandate, and presents the
 * proposal once it has, if the signing request did not already. It never
 * signs anything and never adopts a household.
 */
export async function proposeForReview(store:Store,c:MemberRuntimeConfig,household:string,now=Date.now){
 const at=now(),r=reviewRuntime(store,c,()=>at);
 const held=r.reviewProposals.find(v=>(v as ReviewProposal).household===household) as ReviewProposal|null;
 if(!held)throw new ReviewInvitationError('Not a review household; the reviewer has to sign in once first');
 if(!r.authority.matchesActivePrincipalScope(held.principal,household,[REVIEW_SHOP.presenter]))throw new ReviewInvitationError('Review principal changed or unavailable');
 const id=household+'.1',mandate=r.engine.mandates.get(id);
 if(!mandate)return {household,mandate:id,awaitingSignature:true as const,claimHeld:!!r.engine.mandates.claimFor(id,at)};
 const {proven}=r.authority.credentialProof(held.principal);
 if(proven.length!==1)throw new ReviewInvitationError(`Exactly one signed-in review credential is required; ${proven.length} have signed in`);
 // A binding derives its context from a live session. This one never leaves the locked unit and is revoked before commit.
 return presentReviewProposal(r,held.principal,mandate,at,()=>{
  const internal=r.authority.createSessionAfterVerification(proven[0]!,at+60_000);
  try{r.bindings.bind(internal.token,id);}finally{r.authority.revokeSession(internal.id);}
 });
}
