import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { postgresStore,type Identity } from './store.ts';
import { memberRuntimeIdentity,type MemberRuntimeConfig } from './config.ts';
import { memberRuntime } from './runtime.ts';
import { openStatementAuthorisations } from './statement-authorisation.ts';
import { memberTransport } from '../member-login/transport.ts';
import { memberReadBoundary } from '../member-read/gate.ts';
import { createApp } from '../../engine/src/http.ts';
import { Registry } from '../../engine/src/shared/registry.ts';
import { RecoveryRegister } from '../../engine/src/hub/node.ts';
import { ApprovalDesk } from '../../engine/src/hub/approval.ts';
import { PermissionLedger } from '../../engine/src/hub/permissions.ts';
import type { PreparedAssertion } from './login.ts';
const json=(status:number,error:string)=>Response.json({error},{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
const authPaths=['/auth/enrollment/options','/auth/enrollment/verify','/auth/login/options','/auth/login/verify','/auth/session','/auth/logout'];
async function body(request:Request,max:number,timeout:number){
 const reader=request.body?.getReader();if(!reader)throw new Error('Body required');let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([(async()=>{const chunks:Uint8Array[]=[];let n=0;while(true){const {done,value}=await reader.read();if(done)break;n+=value.byteLength;if(n>max)throw new Error('Body limit');chunks.push(value);}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));})(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Body timeout')),timeout);})]);}
 finally{if(timer)clearTimeout(timer);void reader.cancel().catch(()=>{});}
}
export async function openPostgresMemberHTTP(pool:Pool,deployment:Identity,input:MemberRuntimeConfig,now=Date.now){
 const identity=memberRuntimeIdentity(input),c=identity.config;
 if(deployment.environment!==c.environment||deployment.origin!==c.origin)throw new Error('Deployment scope mismatch');
 const unit=postgresStore(pool,deployment);
 function binding(store:Parameters<Parameters<typeof unit.run>[0]>[0]){const config=store.map<typeof identity>('member_config'),old=config.get('current');if(old&&(old.profile!==identity.profile||old.fingerprint!==identity.fingerprint||memberRuntimeIdentity(old.config).fingerprint!==identity.fingerprint))throw new Error('Bound runtime mismatch');if(!old)config.set('current',identity);}
 await unit.run(binding);let pending=0;
 return {descriptor:{...deployment,fingerprint:identity.fingerprint},
  async fetch(request:Request,context:{peer:string}):Promise<Response>{
   const url=new URL(request.url),match=/^\/member\/operations\/([a-f0-9-]{36})(?:\/(submit|outcome|cancel))?$/.exec(url.pathname),prepare=url.pathname==='/member/statements/prepare',member=prepare||!!match;
   if(url.origin!==c.origin||url.username||url.password||url.hash||request.headers.has('cookie')||(request.headers.has('origin')&&request.headers.get('origin')!==c.origin)||['cross-site','same-site'].includes(request.headers.get('sec-fetch-site')??''))return json(403,'request_unavailable');
   if(!member&&!authPaths.includes(url.pathname)&&url.pathname!=='/offers'&&!/^\/offers\/[A-Za-z0-9_-]+(?:\/(approval|statement|settlement))?$/.test(url.pathname)&&!/^\/_node\/mandates\/[A-Za-z0-9_-]+$/.test(url.pathname))return json(404,'request_unavailable');
   if(typeof context?.peer!=='string'||!context.peer||context.peer.length>256||pending>=c.maximumPending)return json(503,'unavailable');
   if(!['GET','POST'].includes(request.method))return json(405,'method_not_allowed');
   pending++;
   try{
    const admitted=await unit.run(store=>{
     binding(store);const budgets=store.map<{until:number;used:number}>('member_admission'),at=now();
     for(const [key,value]of budgets)if(value.until<=at)budgets.delete(key);
     const key=createHash('sha256').update(context.peer).digest('hex'),value=budgets.get(key)??{until:at+c.budgetWindowMs,used:0};
     if(value.used>=c.maximumRequests)return false;if(!budgets.has(key)&&budgets.size>=c.maximumTrackedTokens)return false;
     budgets.set(key,{...value,used:value.used+1});return true;
    });if(!admitted)return json(429,'rate_limited');
    let inputBody:unknown,bytes:string|undefined;
    if(request.method==='POST'){
     if(request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')return json(400,'invalid_body');
     try{inputBody=await body(request,c.maximumBodyBytes,c.bodyTimeoutMs);bytes=JSON.stringify(inputBody);}catch{return json(400,'invalid_body');}
    }
    if(request.signal.aborted)return json(400,'request_aborted');
    const fixed=new Request(request.url,{method:request.method,headers:request.headers,...(bytes===undefined?{}:{body:bytes})});
    const result=await unit.run(async store=>{
     binding(store);const r=memberRuntime(store,c,now);
     if(member){
      if(url.search)return {status:404,body:JSON.stringify({error:'operation_unavailable'})};
      const action=prepare?'prepare':match![2]??'review',method=['review','outcome'].includes(action)?'GET':'POST';
      if(request.method!==method)return {status:405,body:JSON.stringify({error:'method_not_allowed'})};
      const token=request.headers.get('authorization')?.match(/^Bearer (amr1_[A-Za-z0-9_-]{43})$/)?.[1];if(!token)return {status:401,body:JSON.stringify({error:'unauthorised'})};
      const api=openStatementAuthorisations(r,{environment:c.environment,origin:c.origin,rpID:c.rpID,maximumLifetimeMs:c.maximumLifetimeMs,maxSessionLifetimeMs:c.maxSessionLifetimeMs,engine:r.engine.config,now});
      if(action==='submit'&&(!inputBody||typeof inputBody!=='object'||Object.keys(inputBody).join(',')!=='assertion'))throw new Error('Invalid assertion');
      if(action==='cancel'&&(!inputBody||typeof inputBody!=='object'||Array.isArray(inputBody)||Object.keys(inputBody).length))throw new Error('Invalid cancellation');
      const value=await (action==='prepare'?api.prepare(token,inputBody as {offer:string;disputed:string[]}):action==='review'?api.read(token,match![1]!):action==='outcome'?api.outcome(token,match![1]!):action==='cancel'?api.cancel(token,match![1]!):api.settle(token,match![1]!,(inputBody as {assertion:PreparedAssertion}).assertion));
      return {status:200,body:JSON.stringify(value)};
     }
     const hub={deliveries:r.deliveries,registry:new Registry(store),recovery:new RecoveryRegister(store),approvals:new ApprovalDesk(store),permissions:new PermissionLedger(store)};
     const read=memberReadBoundary({environment:c.environment,origin:c.origin,now,resolveSession:r.authority.resolveSession,ownerOf:async resource=>{
      let owner:{household:string;presenter?:string};try{if(resource.kind==='offer'){const o=r.engine.mustGet(resource.id);owner={household:o.household,presenter:o.presenter};}else owner={household:r.engine.mandates.mustGet(resource.id).household};}catch{r.authority.invalidateResource(resource);return;}
      try{r.authority.bindResource(resource,owner);}catch{r.authority.invalidateResource(resource);return;}return r.authority.ownerOf(resource);
     },next:createApp(r.engine,hub)});
     const reply=await memberTransport({...r,read,admit:async()=>true,maxBodyBytes:c.maximumBodyBytes})(fixed,context);
     return {status:reply.status,body:await reply.text()};
    });
    if(Buffer.byteLength(result.body)>1_048_576)return json(503,'response_unavailable');
    return new Response(result.status===204?null:result.body,{status:result.status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});
   }catch(error){return json((error as Error).message==='PostgreSQL writer fenced'||/^[A-Z0-9]{5}$/.test((error as {code?:string}).code??'')?503:member?404:503,'request_unavailable');}finally{pending--;}
  }
 };
}
