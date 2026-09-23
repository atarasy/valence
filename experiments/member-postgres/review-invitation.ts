import {randomUUID} from 'node:crypto';
import type {Store} from '../../engine/src/common/store.ts';
import {memberRuntimeIdentity,type MemberRuntimeConfig} from './config.ts';
import {memberRuntime} from './runtime.ts';
/** This module's own refusals, so the operator command prints them and nothing from the driver. */
export class ReviewInvitationError extends Error {}
type ReviewPrincipal={principal:string;issuedAt:number;expiresAt:number};
/**
 * Trusted operator capability for App Review on the production deployment.
 * Not imported by the deployed HTTP entry.
 *
 * Each call provisions one fresh principal, unclaimed and with no presenter
 * grants, and issues it one single-use invitation through the ordinary
 * enrolment service. The passkey is created on the reviewer's device by that
 * enrolment; nothing here makes a credential, a household, a mandate or an
 * offer. A household is the name of its key (§13.2, question 55), so none can
 * exist before the reviewer's device registers one.
 *
 * Unlike device acceptance, nothing is seeded and no second call reuses the
 * first principal: an invitation lives `maximumLifetimeMs`, and a spent or
 * expired one is replaced by issuing again, which leaves the earlier principal
 * as it was. Every principal issued is recorded with its expiry.
 */
export function issueReviewInvitation(store:Store,c:MemberRuntimeConfig){
 const expected=memberRuntimeIdentity(c),bound=store.map<typeof expected>('member_config').get('current');
 if(c.environment!=='production'||!bound||bound.profile!==expected.profile||bound.fingerprint!==expected.fingerprint||memberRuntimeIdentity(bound.config).fingerprint!==expected.fingerprint)throw new ReviewInvitationError('Review invitation configuration unavailable');
 const issued=store.map<ReviewPrincipal>('member_review_invitations');
 const principal='review_member_'+randomUUID().replaceAll('-','');
 const r=memberRuntime(store,c);
 r.authority.provisionUnclaimedPrincipal(principal,[]);
 if(!r.authority.matchesActivePrincipalScope(principal,null,[]))throw new ReviewInvitationError('Review principal unavailable');
 const invitation=r.enrollment.issueInvitation(principal);
 issued.set(principal,{principal,issuedAt:r.now(),expiresAt:invitation.expiresAt});
 return {principal,...invitation};
}
