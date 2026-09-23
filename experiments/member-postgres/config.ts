import { createHash } from 'node:crypto';
import { androidAssertionOrigins } from '../member-login/assertion-origins.ts';
export type MemberRuntimeConfig = { environment:string; origin:string; rpID:string; androidAppOrigins:string[]; explorationRate:number; reminderLimit:0|1; recoveryGraceDays:number; dayBoundary:'UTC'; maximumLifetimeMs:number; maxSessionLifetimeMs:number; maximumBodyBytes:number; bodyTimeoutMs:number; maximumPending:number; budgetWindowMs:number; maximumRequests:number; maximumTrackedTokens:number; invitationLifetimeMs:number };
/**
 * The shape of the runtime configuration a deployment is bound under. `.3`
 * added `invitationLifetimeMs` on 2026-09-23: an invitation had lived
 * `maximumLifetimeMs`, the five minutes a ceremony or an operation stays open,
 * which no App Reviewer and few invited members would meet. A deployment bound
 * under `.2` answers `Bound runtime mismatch` until `rebind-runtime.ts` moves
 * its row forward (MIGRATION_COMMAND.md).
 */
export const MEMBER_RUNTIME_PROFILE='atarasy.member-runtime.3' as const;
const keys='androidAppOrigins,bodyTimeoutMs,budgetWindowMs,dayBoundary,environment,explorationRate,invitationLifetimeMs,maxSessionLifetimeMs,maximumBodyBytes,maximumLifetimeMs,maximumPending,maximumRequests,maximumTrackedTokens,origin,recoveryGraceDays,reminderLimit,rpID';
export function memberRuntimeIdentity(input:MemberRuntimeConfig) {
 const c=structuredClone(input),originURL=new URL(c.origin);
 // OPS-01: the only exception to https is a `local` deployment serving http://127.0.0.1,
 // which never leaves the machine. Every other environment still needs https.
 const isLocalOrigin=c.environment==='local'&&originURL.protocol==='http:'&&originURL.hostname==='127.0.0.1';
 if(Object.keys(c).sort().join(',')!==keys||c.dayBoundary!=='UTC'||typeof c.environment!=='string'||!c.environment||originURL.origin!==c.origin||(originURL.protocol!=='https:'&&!isLocalOrigin)||originURL.hostname!==c.rpID||typeof c.explorationRate!=='number'||!(c.explorationRate>0&&c.explorationRate<=1)||![0,1].includes(c.reminderLimit)||!Number.isSafeInteger(c.recoveryGraceDays)||c.recoveryGraceDays<0)throw new Error('Invalid member runtime');
 c.androidAppOrigins=androidAssertionOrigins(c.androidAppOrigins);Object.freeze(c.androidAppOrigins);
 for(const n of [c.maximumLifetimeMs,c.invitationLifetimeMs,c.maxSessionLifetimeMs,c.maximumBodyBytes,c.bodyTimeoutMs,c.maximumPending,c.budgetWindowMs,c.maximumRequests,c.maximumTrackedTokens])if(!Number.isSafeInteger(n)||n<=0)throw new Error('Invalid member runtime limits');
 const ordered=Object.fromEntries(Object.entries(c).sort(([a],[b])=>a<b?-1:a>b?1:0));
 return {profile:MEMBER_RUNTIME_PROFILE,config:Object.freeze(c),fingerprint:createHash('sha256').update(JSON.stringify([MEMBER_RUNTIME_PROFILE,ordered])).digest('hex')};
}
