import type { Store } from '../../engine/src/common/store.ts';
import { ValenceEngine } from '../../engine/src/engine/offers.ts';
import { InMemoryLedger } from '../../engine/src/engine/ledger.ts';
import { DeliveryRegister } from '../../engine/src/hub/delivery.ts';
import { LocalDeliveries } from '../../engine/src/engine/delivery-source.ts';
import { memberRecords,records } from './records.ts';
import { openMemberAuthority } from './authority.ts';
import { openVerifiedLogin } from './login.ts';
import { openEnrollment } from './enrollment.ts';
import { openMandateBindings } from './mandate-binding.ts';
import { openOperationJournal,type JournalOperation } from './operation-journal.ts';
import type { MemberRuntimeConfig } from './config.ts';
export function memberRuntime(store:Store,c:MemberRuntimeConfig,now=Date.now) {
 const path=memberRecords(store,{environment:c.environment,audience:c.origin});
 const engine=new ValenceEngine(new InMemoryLedger(store),{explorationRate:c.explorationRate,reminderLimit:c.reminderLimit,recoveryGraceDays:c.recoveryGraceDays,relyingPartyId:c.rpID,memberStatementScope:{environment:c.environment,origin:c.origin}},store);
 const deliveries=new DeliveryRegister(store);engine.readDeliveriesFrom(new LocalDeliveries(deliveries));
 const authority=openMemberAuthority(path,{environment:c.environment,audience:c.origin,maxSessionLifetimeMs:c.maxSessionLifetimeMs,now});
 const p={environment:c.environment,origin:c.origin,rpID:c.rpID,challengeLifetimeMs:c.maximumLifetimeMs,sessionLifetimeMs:c.maxSessionLifetimeMs,now};
 const login=openVerifiedLogin(path,authority,p),enrollment=openEnrollment(path,authority,login,{...p,rpName:'Atarasy',invitationLifetimeMs:c.maximumLifetimeMs});
 const bindings=openMandateBindings(path,authority,login,engine),journal=openOperationJournal(path,authority,bindings,{maximumLifetimeMs:c.maximumLifetimeMs,now});
 const reviews=records<any>(path,'member_reviews');
 // Journal owns the operation map. Expose only its own scoped read method to avoid a duplicate map.
 const operations={find:journal.findBlocking};
 return {path,engine,deliveries,authority,login,enrollment,bindings,journal,reviews,operations};
}
