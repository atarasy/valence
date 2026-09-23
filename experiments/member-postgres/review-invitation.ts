import {randomUUID} from 'node:crypto';
import type {Store} from '../../engine/src/common/store.ts';
import {memberRuntimeIdentity,type MemberRuntimeConfig} from './config.ts';
import {memberRuntime} from './runtime.ts';
/** This module's own refusals, so the operator command prints them and nothing from the driver. */
export class ReviewInvitationError extends Error {}
/**
 * The production binding both review commands require. The registers
 * themselves are the runtime's (`reviewPrincipals`, `reviewProposals`),
 * because the sign-in and mandate routes read them too, and a PostgreSQL unit
 * opens each namespace once.
 */
export function reviewRuntime(store:Store,c:MemberRuntimeConfig,now=Date.now){
 const expected=memberRuntimeIdentity(c),bound=store.map<typeof expected>('member_config').get('current');
 if(c.environment!=='production'||!bound||bound.profile!==expected.profile||bound.fingerprint!==expected.fingerprint||memberRuntimeIdentity(bound.config).fingerprint!==expected.fingerprint)throw new ReviewInvitationError('Review configuration unavailable');
 return memberRuntime(store,c,now);
}
/**
 * Trusted operator capability for App Review on the production deployment.
 * Not imported by the deployed HTTP entry.
 *
 * Each call provisions one fresh principal, unclaimed and with no presenter
 * grants, and issues it one single-use invitation through the ordinary
 * enrolment service, valid for `invitationLifetimeMs`. The passkey is created
 * on the reviewer's device by that enrolment; nothing here makes a credential,
 * a household, a mandate or an offer. The household is adopted at the
 * reviewer's first sign-in (member-adoption.ts), which also grants the review
 * shop because the principal is recorded here (review-shop.ts).
 *
 * A spent or expired invitation is replaced by issuing again, which leaves the
 * earlier principal as it was.
 */
export function issueReviewInvitation(store:Store,c:MemberRuntimeConfig){
 const r=reviewRuntime(store,c),principal='review_member_'+randomUUID().replaceAll('-','');
 r.authority.provisionUnclaimedPrincipal(principal,[]);
 if(!r.authority.matchesActivePrincipalScope(principal,null,[]))throw new ReviewInvitationError('Review principal unavailable');
 const invitation=r.enrollment.issueInvitation(principal);
 r.reviewPrincipals.insert(principal,{principal,issuedAt:r.now(),expiresAt:invitation.expiresAt});
 return {principal,...invitation};
}
