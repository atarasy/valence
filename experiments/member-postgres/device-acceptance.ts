import {randomUUID} from 'node:crypto';
import type {Store} from '../../engine/src/common/store.ts';
import {memberRuntimeIdentity,type MemberRuntimeConfig} from './config.ts';
import {memberRuntime} from './runtime.ts';
type Acceptance={principal:string;household:string;createdAt:number};
function checked(store:Store,c:MemberRuntimeConfig){
 const expected=memberRuntimeIdentity(c),bound=store.map<typeof expected>('member_config').get('current');
 if(c.environment!=='development'||!bound||bound.profile!==expected.profile||bound.fingerprint!==expected.fingerprint||memberRuntimeIdentity(bound.config).fingerprint!==expected.fingerprint)throw new Error('Acceptance configuration unavailable');
 return store.map<Acceptance>('member_device_acceptance');
}
/** Trusted operator capability. Not imported by the deployed HTTP entry. */
export function prepareDeviceAcceptance(store:Store,c:MemberRuntimeConfig){
 const entries=checked(store,c);if(entries.has('current'))throw new Error('Acceptance already prepared; inspect status');
 const value={principal:'dev_member_'+randomUUID().replaceAll('-',''),household:'dev_house_'+randomUUID().replaceAll('-',''),createdAt:Date.now()};
 memberRuntime(store,c).authority.provisionPrincipal(value.principal,value.household,[]);
 entries.set('current',value);return value;
}
export function deviceAcceptanceStatus(store:Store,c:MemberRuntimeConfig){
 const value=checked(store,c).get('current');if(!value)return {prepared:false as const};
 const principal=store.map<{household:string;presenters:string;disabled:number}>('member_principals').get(value.principal);
 if(!principal||principal.household!==value.household||principal.presenters!=='[]'||principal.disabled!==0)throw new Error('Acceptance principal changed or unavailable');
 const credentials=store.map<{principal:string;revoked:number}>('member_credentials');
 const activeCredentials=[...credentials.values()].filter(v=>v.principal===value.principal&&v.revoked===0).length;
 return {prepared:true as const,...value,presenterGrants:0,activeCredentials};
}
export function inviteDeviceAcceptance(store:Store,c:MemberRuntimeConfig){
 const value=checked(store,c).get('current');if(!value)throw new Error('Acceptance not prepared');
 const r=memberRuntime(store,c);
 if(!r.authority.matchesActivePrincipalScope(value.principal,value.household,[]))throw new Error('Acceptance principal changed or unavailable');
 return r.enrollment.issueInvitation(value.principal);
}
