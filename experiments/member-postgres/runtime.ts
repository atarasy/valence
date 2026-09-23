import type { Store } from '../../engine/src/common/store.ts';
import { ValenceEngine } from '../../engine/src/engine/offers.ts';
import { InMemoryLedger } from '../../engine/src/engine/ledger.ts';
import { CarriageQuotes } from '../../engine/src/hub/carriage-quote.ts';
import { DeliveryRegister } from '../../engine/src/hub/delivery.ts';
import { LocalDeliveries } from '../../engine/src/engine/delivery-source.ts';
import { memberRecords,records } from './records.ts';
import { openMemberAuthority } from './authority.ts';
import { openVerifiedLogin } from './login.ts';
import { openEnrollment } from './enrollment.ts';
import { openMandateBindings } from './mandate-binding.ts';
import { openOperationJournal,type JournalOperation } from './operation-journal.ts';
import type { MemberRuntimeConfig } from './config.ts';
import { adoptOnSignIn } from './member-adoption.ts';
export function memberRuntime(store:Store,c:MemberRuntimeConfig,now=Date.now) {
 const path=memberRecords(store,{environment:c.environment,audience:c.origin});
 const memberScope={environment:c.environment,origin:c.origin,androidAppOrigins:c.androidAppOrigins};
 const engine=new ValenceEngine(new InMemoryLedger(store),{explorationRate:c.explorationRate,reminderLimit:c.reminderLimit,recoveryGraceDays:c.recoveryGraceDays,relyingPartyId:c.rpID,memberStatementScope:memberScope,memberDecisionScope:memberScope,memberWithdrawalScope:memberScope},store);
 const deliveries=new DeliveryRegister(store);engine.readDeliveriesFrom(new LocalDeliveries(deliveries));
 const quotes=new CarriageQuotes(store);
 const approvalCarriage=(id:string)=>engine.mustGet(id,now()).binding==='digital'?quotes.find(id):deliveries.find(id);
 engine.readApprovalCarriageFrom({async find(id){return approvalCarriage(id);}});
 const authority=openMemberAuthority(path,{environment:c.environment,audience:c.origin,maxSessionLifetimeMs:c.maxSessionLifetimeMs,now});
 // The sign-in hook needs the whole runtime, which does not exist until the login inside it does.
 let signedIn:(credential:string)=>void=()=>{throw new Error('Runtime incomplete');};
 const p={environment:c.environment,origin:c.origin,rpID:c.rpID,androidAppOrigins:c.androidAppOrigins,challengeLifetimeMs:c.maximumLifetimeMs,sessionLifetimeMs:c.maxSessionLifetimeMs,now,onSignIn:(credential:string)=>signedIn(credential)};
 const login=openVerifiedLogin(path,authority,p),enrollment=openEnrollment(path,authority,login,{...p,rpName:'Atarasy',invitationLifetimeMs:c.invitationLifetimeMs});
 const bindings=openMandateBindings(path,authority,login,engine),journal=openOperationJournal(path,authority,bindings,{maximumLifetimeMs:c.maximumLifetimeMs,now});
 const reviews=records<any>(path,'member_reviews');
 // App Review: the principals review-invite.ts issued, and the review shop and proposals (review-shop.ts).
 const reviewPrincipals=records<any>(path,'member_review_invitations'),reviewProposals=records<any>(path,'member_review_proposals');
 // Journal owns the operation map. Expose only its own scoped read method to avoid a duplicate map.
 const operations={find:journal.findBlocking,findCurrent:journal.findCurrent};
 const runtime={path,engine,deliveries,quotes,approvalCarriage,now,authority,login,enrollment,bindings,journal,reviews,operations,reviewPrincipals,reviewProposals};
 signedIn=(credential:string)=>adoptOnSignIn(runtime,credential);
 return runtime;
}
export type ReturnTypeMemberRuntime = ReturnType<typeof memberRuntime>;
