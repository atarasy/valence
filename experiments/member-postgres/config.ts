import { createHash } from 'node:crypto';
export type MemberRuntimeConfig = { environment:string; origin:string; rpID:string; explorationRate:number; reminderLimit:0|1; recoveryGraceDays:number; dayBoundary:'UTC'; maximumLifetimeMs:number; maxSessionLifetimeMs:number; maximumBodyBytes:number; bodyTimeoutMs:number; maximumPending:number; budgetWindowMs:number; maximumRequests:number; maximumTrackedTokens:number };
const keys='bodyTimeoutMs,budgetWindowMs,dayBoundary,environment,explorationRate,maxSessionLifetimeMs,maximumBodyBytes,maximumLifetimeMs,maximumPending,maximumRequests,maximumTrackedTokens,origin,recoveryGraceDays,reminderLimit,rpID';
export function memberRuntimeIdentity(input:MemberRuntimeConfig) {
 const c=structuredClone(input);
 if(Object.keys(c).sort().join(',')!==keys||c.dayBoundary!=='UTC'||typeof c.environment!=='string'||!c.environment||new URL(c.origin).origin!==c.origin||new URL(c.origin).protocol!=='https:'||new URL(c.origin).hostname!==c.rpID||typeof c.explorationRate!=='number'||!(c.explorationRate>0&&c.explorationRate<=1)||![0,1].includes(c.reminderLimit)||!Number.isSafeInteger(c.recoveryGraceDays)||c.recoveryGraceDays<0)throw new Error('Invalid member runtime');
 for(const n of [c.maximumLifetimeMs,c.maxSessionLifetimeMs,c.maximumBodyBytes,c.bodyTimeoutMs,c.maximumPending,c.budgetWindowMs,c.maximumRequests,c.maximumTrackedTokens])if(!Number.isSafeInteger(n)||n<=0)throw new Error('Invalid member runtime limits');
 const ordered=Object.fromEntries(Object.entries(c).sort(([a],[b])=>a<b?-1:a>b?1:0));
 return {profile:'atarasy.member-runtime.1' as const,config:Object.freeze(c),fingerprint:createHash('sha256').update(JSON.stringify(['atarasy.member-runtime.1',ordered])).digest('hex')};
}
