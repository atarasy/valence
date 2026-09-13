import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { openAtomicStore } from './atomic-store.ts';
import { openStatementAuthorisations } from './statement-authorisation.ts';
import { prepareLocalCutover, activateLocalCutover } from './local-cutover.ts';
import type { PreparedAssertion } from '../member-login/login.ts';
export type MemberRuntimeConfig = { environment:string; origin:string; rpID:string; explorationRate:number; reminderLimit:0|1; recoveryGraceDays:number; dayBoundary:'UTC'; maximumLifetimeMs:number; maxSessionLifetimeMs:number; maximumBodyBytes:number; bodyTimeoutMs:number; maximumPending:number; budgetWindowMs:number; maximumRequests:number; maximumTrackedTokens:number };
const keys='bodyTimeoutMs,budgetWindowMs,dayBoundary,environment,explorationRate,maxSessionLifetimeMs,maximumBodyBytes,maximumLifetimeMs,maximumPending,maximumRequests,maximumTrackedTokens,origin,recoveryGraceDays,reminderLimit,rpID';
export function memberRuntimeIdentity(input:MemberRuntimeConfig) {
 const c=structuredClone(input);
 if(Object.keys(c).sort().join(',')!==keys||c.dayBoundary!=='UTC'||typeof c.environment!=='string'||!c.environment||new URL(c.origin).origin!==c.origin||new URL(c.origin).protocol!=='https:'||new URL(c.origin).hostname!==c.rpID||typeof c.explorationRate!=='number'||!(c.explorationRate>0&&c.explorationRate<=1)||![0,1].includes(c.reminderLimit)||!Number.isSafeInteger(c.recoveryGraceDays)||c.recoveryGraceDays<0)throw new Error('Invalid member runtime');
 for(const n of [c.maximumLifetimeMs,c.maxSessionLifetimeMs,c.maximumBodyBytes,c.bodyTimeoutMs,c.maximumPending,c.budgetWindowMs,c.maximumRequests,c.maximumTrackedTokens])if(!Number.isSafeInteger(n)||n<=0)throw new Error('Invalid member runtime limits');
 const ordered=Object.fromEntries(Object.entries(c).sort(([a],[b])=>a<b?-1:a>b?1:0));
 return {profile:'atarasy.member-runtime.1' as const,config:Object.freeze(c),fingerprint:createHash('sha256').update(JSON.stringify(['atarasy.member-runtime.1',ordered])).digest('hex')};
}
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
export async function inputBody(request:Request,maximum:number,timeout:number) {
 const reader=request.body?.getReader();if(!reader)return undefined;
 let timer:ReturnType<typeof setTimeout>|undefined;
 try {
  const read=async()=>{const chunks:Uint8Array[]=[];let size=0;while(true){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>maximum)throw new Error('Body limit');chunks.push(next.value.slice());}const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));};
  return await Promise.race([read(),new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error('Body timeout')),timeout);})]);
 }finally{if(timer)clearTimeout(timer);void reader.cancel().catch(()=>{});}
}
/** Explicit trusted path selection; never supplied by an HTTP caller. No listener is opened. */
export async function openMemberHTTP(path:string,input:MemberRuntimeConfig) {
 const identity=memberRuntimeIdentity(input),c=identity.config,selected=realpathSync(path),scope={environment:c.environment,audience:c.origin};
 const binding=openAtomicStore(selected,scope);
 try {await binding.run(store=>{
  const activated=store.map<{runtime:string}>('writer_activation').get('current');if(activated&&activated.runtime!==identity.fingerprint)throw new Error('Activated runtime mismatch');
  const map=store.map<typeof identity>('member_runtime'),existing=map.get('current');
  if(existing&&(existing.profile!==identity.profile||memberRuntimeIdentity(existing.config).fingerprint!==identity.fingerprint))throw new Error('Bound runtime mismatch');
  if(existing&&existing.fingerprint!==identity.fingerprint)throw new Error('Bound runtime mismatch');
  if(!existing)map.set('current',identity);
 });}finally{binding.close();}
 const api=openStatementAuthorisations(selected,{environment:c.environment,origin:c.origin,rpID:c.rpID,maximumLifetimeMs:c.maximumLifetimeMs,maxSessionLifetimeMs:c.maxSessionLifetimeMs,engine:{explorationRate:c.explorationRate,reminderLimit:c.reminderLimit,recoveryGraceDays:c.recoveryGraceDays,relyingPartyId:c.rpID}});
 try { await api.initialise(); } catch(error) { api.close(); throw error; }
 let closed=false,pending=0,tail:Promise<unknown>=Promise.resolve();const budgets=new Map<string,{until:number;used:number}>();
 return {
  descriptor:Object.freeze({path:selected,fingerprint:identity.fingerprint}),
  prepareCutover(directory:string){return prepareLocalCutover(selected,directory,{environment:c.environment,origin:c.origin,rpID:c.rpID},identity.fingerprint);},
  activateCutover(ticket:string){return activateLocalCutover(selected,{environment:c.environment,origin:c.origin,rpID:c.rpID},ticket,identity.fingerprint);},
  async fetch(request:Request):Promise<Response> {
   const url=new URL(request.url);
   if(url.origin!==c.origin||url.search||url.hash||(request.headers.has('origin')&&request.headers.get('origin')!==c.origin))return json({error:'invalid_request'},400);
   const match=/^\/member\/operations\/([a-f0-9-]{36})(?:\/(submit|outcome|cancel))?$/.exec(url.pathname),prepare=url.pathname==='/member/statements/prepare';
   if(!prepare&&!match)return json({error:'not_found'},404);
   const action=prepare?'prepare':match![2]??'review',method=['review','outcome'].includes(action)?'GET':'POST';
   if(request.method!==method)return json({error:'method_not_allowed'},405);
   const auth=request.headers.get('authorization')??'';
   if(!/^Bearer amr1_[A-Za-z0-9_-]{43}$/.test(auth))return json({error:'unauthorised'},401);
   if(closed||pending>=c.maximumPending)return json({error:'unavailable'},503);
   const token=auth.slice(7),at=Date.now(),key=createHash('sha256').update(token).digest('hex');
   for(const [k,v]of budgets)if(v.until<=at)budgets.delete(k);
   let budget=budgets.get(key);if(!budget){if(budgets.size>=c.maximumTrackedTokens)return json({error:'unavailable'},503);budget={until:at+c.budgetWindowMs,used:0};budgets.set(key,budget);}
   if(budget.used>=c.maximumRequests)return json({error:'rate_limited'},429);budget.used++;pending++;
   try {
    let body:unknown;
    if(method==='POST'){if(request.headers.get('content-type')?.split(';')[0]?.trim()!=='application/json')return json({error:'invalid_request'},400);try{body=await inputBody(request,c.maximumBodyBytes,c.bodyTimeoutMs);}catch{return json({error:'invalid_body'},400);}}
    if(request.signal.aborted)return json({error:'invalid_request'},400);
    if(action==='submit'&&(!body||typeof body!=='object'||Object.keys(body).join(',')!=='assertion'))return json({error:'invalid_request'},400);
    if(action==='cancel'&&(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length))return json({error:'invalid_request'},400);
    const work=tail.then<unknown>(()=>action==='prepare'?api.prepare(token,body as {offer:string;disputed:string[]}):action==='review'?api.read(token,match![1]!):action==='outcome'?api.outcome(token,match![1]!):action==='cancel'?api.cancel(token,match![1]!):api.settle(token,match![1]!, (body as {assertion:PreparedAssertion}).assertion));
    tail=work.catch(()=>{});return json(await work);
   }catch(e){return json({error:(e as Error).message==='Atomic writer fenced'?'temporarily_unavailable':'operation_unavailable'},(e as Error).message==='Atomic writer fenced'?503:404);}
   finally{pending--;}
  },
  close(){if(pending)throw new Error('Member requests still active');if(!closed){closed=true;api.close();budgets.clear();}},
 };
}
