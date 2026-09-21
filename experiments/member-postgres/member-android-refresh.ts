import { createHash, randomUUID } from 'node:crypto';
import type { ReturnTypeMemberRuntime } from './runtime.ts';
import { records } from './records.ts';

type Subscription = {
  id:string; household:string; credential:string; session:string; installation:string; fingerprint:string;
  pendingFingerprint:string|null; pendingID:string|null; active:boolean; createdAt:number; updatedAt:number;
};
export type MemberAndroidRefreshHint = { data: { profile: 'atarasy.member-refresh-hint.1' } };
export type MemberAndroidRefreshJob = { id:string; fid:string; payload:MemberAndroidRefreshHint };
export interface MemberAndroidRefreshNotifier { deliver(job:MemberAndroidRefreshJob):Promise<{receipt:string}> }
export class MemberAndroidRefreshError extends Error { constructor(readonly status:number,readonly code:string){super(code);} }
const fail=(status:number,code:string):never=>{throw new MemberAndroidRefreshError(status,code);};
const exact=(value:unknown,keys:string[])=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==[...keys].sort().join(','))fail(400,'invalid_android_refresh_subscription');return value as Record<string,unknown>;};
const installationID=(value:unknown):string=>{if(typeof value!=='string'||value.length<20||value.length>128||!/^[A-Za-z0-9_-]+$/.test(value))fail(400,'invalid_android_refresh_subscription');return value;};
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('base64url');

export function openMemberAndroidRefresh(r:ReturnTypeMemberRuntime){
 const subscriptions=records<Subscription>(r.path,'member_android_refresh_subscriptions'),now=r.now;
 type Principal=NonNullable<ReturnType<typeof r.authority.sessionPrincipal>>;
 const context=(token:string):Principal=>{const value=r.authority.sessionPrincipal(token);if(!value)fail(404,'android_refresh_unavailable');return value as Principal;};
 const fingerprint=(household:string,presenters:string[])=>digest(presenters.slice().sort().map(presenter=>({presenter,offers:r.engine.offersForHousehold(household,presenter,now())})));
 const view=(row:Subscription)=>({profile:'atarasy.member-android-refresh-subscription.1' as const,active:row.active,updatedAt:row.updatedAt});
 return {
  status(token:string){const who=context(token),row=subscriptions.get(who.credential);return row&&row.household===who.household&&row.session===who.session?view(row):{profile:'atarasy.member-android-refresh-subscription.1' as const,active:false,updatedAt:null};},
  register(token:string,value:unknown){
   const who=context(token),body=exact(value,['installation']),installation=installationID(body.installation),claimed=subscriptions.find(row=>row.active&&row.installation===installation&&row.credential!==who.credential);
   if(claimed)fail(409,'android_refresh_channel_unavailable');const notification=r.authority.notificationContext(who.credential,who.session);if(!notification||notification.household!==who.household)fail(404,'android_refresh_unavailable');
   const at=now(),old=subscriptions.get(who.credential),row:Subscription={id:old?.id??randomUUID(),household:who.household,credential:who.credential,session:who.session,installation,fingerprint:fingerprint(who.household,notification.presenters),pendingFingerprint:null,pendingID:null,active:true,createdAt:old?.createdAt??at,updatedAt:at};
   subscriptions.put(who.credential,row);return view(row);
  },
  disable(token:string,value:unknown){const who=context(token);exact(value,[]);const old=subscriptions.get(who.credential);if(!old||old.household!==who.household)return {profile:'atarasy.member-android-refresh-subscription.1' as const,active:false,updatedAt:null};if(!old.active)return view(old);const row={...old,active:false,pendingFingerprint:null,pendingID:null,updatedAt:now()};subscriptions.put(who.credential,row);return view(row);},
  pending():MemberAndroidRefreshJob[]{
   const jobs:MemberAndroidRefreshJob[]=[];subscriptions.each(row=>{if(!row.active)return;const notification=r.authority.notificationContext(row.credential,row.session);if(!notification||notification.household!==row.household){subscriptions.put(row.credential,{...row,active:false,pendingFingerprint:null,pendingID:null,updatedAt:now()});return;}const current=fingerprint(row.household,notification.presenters);let pendingFingerprint=row.pendingFingerprint,pendingID=row.pendingID;if(current!==row.fingerprint&&pendingFingerprint===null){pendingFingerprint=current;pendingID=randomUUID();subscriptions.put(row.credential,{...row,pendingFingerprint,pendingID,updatedAt:now()});}if(pendingFingerprint&&pendingID)jobs.push({id:pendingID,fid:row.installation,payload:{data:{profile:'atarasy.member-refresh-hint.1'}}});});return jobs.sort((a,b)=>a.id.localeCompare(b.id));
  },
  acknowledge(id:string,receipt:string){if(!/^[a-f0-9-]{36}$/.test(id)||typeof receipt!=='string'||!receipt||receipt.length>256||/[\u0000-\u001f\u007f]/.test(receipt))throw new Error('Invalid Android refresh acknowledgement');const row=subscriptions.find(value=>value.pendingID===id);if(!row||!row.pendingFingerprint)throw new Error('Android refresh hint unavailable');subscriptions.put(row.credential,{...row,fingerprint:row.pendingFingerprint,pendingFingerprint:null,pendingID:null,updatedAt:now()});},
 };
}
