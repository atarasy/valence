import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { postgresStore,type Identity } from './store.ts';
import { memberRuntimeIdentity,type MemberRuntimeConfig } from './config.ts';
import { memberRuntime } from './runtime.ts';
import { openWithdrawalAuthorisations } from './withdrawal-authorisation.ts';
import { openDecisionAuthorisations } from './decision-authorisation.ts';
import type { DecisionInput } from '../../engine/src/shared/decisions.ts';
import { openStatementAuthorisations } from './statement-authorisation.ts';
import { openMandateCeremony } from './mandate-ceremony.ts';
import { openMandateChanges } from './mandate-changes.ts';
import type { Assertion } from '../../engine/src/shared/decisions.ts';
import { memberTransport } from '../member-login/transport.ts';
import { memberReadBoundary } from '../member-read/gate.ts';
import { createApp } from '../../engine/src/http.ts';
import { Registry } from '../../engine/src/shared/registry.ts';
import { RecoveryRegister } from '../../engine/src/hub/node.ts';
import { ApprovalDesk } from '../../engine/src/hub/approval.ts';
import { openPermissionRequests } from './permission-requests.ts';
import { openPrivateNode, PrivateNodeError } from './private-node.ts';
import { openMemberRecovery, MemberRecoveryError, type MemberRecoveryNotifier } from './member-recovery.ts';
import { PermissionLedger } from '../../engine/src/hub/permissions.ts';
import type { PreparedAssertion } from './login.ts';
import { presenterRequest } from './presenter-http.ts';
import { badRequest, ValenceError } from '../../engine/src/common/errors.ts';
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
   /**
    * Trusted worker boundary. The notifier must make `notice.id` idempotent and
    * return a receipt only after the configured independent channel accepted it.
    * This method is deliberately absent from the member HTTP surface.
    */
   async deliverRecoveryNotices(notifier:MemberRecoveryNotifier){
    const jobs=await unit.run(store=>{binding(store);return openMemberRecovery(memberRuntime(store,c,now),{rpID:c.rpID,maximumLifetimeMs:c.maximumLifetimeMs}).pendingNotices();});
    let delivered=0;
    for(const job of jobs){const result=await notifier.deliver(job);await unit.run(store=>{binding(store);openMemberRecovery(memberRuntime(store,c,now),{rpID:c.rpID,maximumLifetimeMs:c.maximumLifetimeMs}).acknowledgeNotice(job.notice.id,result.receipt);});delivered++;}
    return {delivered};
   },
   async fetch(request:Request,context:{peer:string}):Promise<Response>{
   const url=new URL(request.url),match=/^\/member\/operations\/([a-f0-9-]{36})(?:\/(submit|outcome|cancel))?$/.exec(url.pathname),prepare=url.pathname==='/member/statements/prepare',digital=url.pathname==='/member/decisions/prepare',withdrawal=url.pathname==='/member/withdrawals/prepare',mandate=/^\/member\/mandates\/(list|prepare|submit)$/.exec(url.pathname),mandateEffective=url.pathname==='/member/mandates/effective',mandateChanges=/^\/member\/mandates\/changes(?:\/([a-f0-9-]{36})(?:\/(prepare|submit|cancel))?)?$/.exec(url.pathname),permission=/^\/member\/permissions\/(list|revoke)$/.exec(url.pathname),permissionRequest=/^\/member\/permissions\/requests(?:\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})(?:\/(grant|cancel))?)?$/.exec(url.pathname),privateNode=/^\/member\/private-node\/records(?:\/([a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}))?$/.exec(url.pathname),recovery=/^\/member\/recovery(?:\/.*)?$/.test(url.pathname),member=prepare||digital||withdrawal||!!match||!!mandate||mandateEffective||!!mandateChanges||!!permission||!!permissionRequest||!!privateNode||recovery,presenter=/^\/presenter\/(self|configs|disclosures|permission-requests(?:\/[a-f0-9-]{36}\/duplicate-check)?|offers(\/[A-Za-z0-9_-]+(\/(present|delivery|recovery|carriage-quote))?)?)$/.test(url.pathname);
   if(url.origin!==c.origin||url.username||url.password||url.hash||request.headers.has('cookie')||(request.headers.has('origin')&&request.headers.get('origin')!==c.origin)||['cross-site','same-site'].includes(request.headers.get('sec-fetch-site')??''))return json(403,'request_unavailable');
   // §13.2, question 55. A mandate identifier carries a colon and a full stop,
   // and a path may percent-encode either, so the segment filter admits them and
   // the read boundary decodes and checks the form. A filter of `[A-Za-z0-9_-]+`
   // made this route answer 404 for every real identifier, so a household could
   // not read its own mandate and `RemoteMandates` read every one as absent.
   if(!member&&!presenter&&!authPaths.includes(url.pathname)&&url.pathname!=='/offers'&&!/^\/offers\/[A-Za-z0-9_-]+(?:\/(approval|statement|settlement))?$/.test(url.pathname)&&!/^\/_node\/mandates\/[A-Za-z0-9_.:%-]+$/.test(url.pathname))return json(404,'request_unavailable');
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
     if(presenter)return presenterRequest(r,{quotes:r.quotes,deliveries:r.deliveries,registry:new Registry(store),recovery:new RecoveryRegister(store),approvals:new ApprovalDesk(store),permissions:new PermissionLedger(store)},fixed,inputBody);
     if(member){
      if(url.search)return {status:404,body:JSON.stringify({error:'operation_unavailable'})};
      if(recovery){
       const token=request.headers.get('authorization')?.match(/^Bearer (amr1_[A-Za-z0-9_-]{43})$/)?.[1];if(!token)return {status:401,body:JSON.stringify({error:'unauthorised'})};
       const api=openMemberRecovery(r,{rpID:c.rpID,maximumLifetimeMs:c.maximumLifetimeMs}),path=url.pathname,body=inputBody;
       if(path==='/member/recovery/key'&&request.method==='GET')return {status:200,body:JSON.stringify(api.recoveryKey(token))};
       if(path==='/member/recovery/key/prepare'&&request.method==='POST')return {status:200,body:JSON.stringify(api.prepareRecoveryKey(token,body))};
       if(path==='/member/recovery/key/register'&&request.method==='POST')return {status:200,body:JSON.stringify(await api.registerRecoveryKey(token,body))};
       if(path==='/member/recovery/participant'&&request.method==='POST')return {status:200,body:JSON.stringify(api.participant(token,body))};
       if(path==='/member/recovery/configuration'&&request.method==='GET')return {status:200,body:JSON.stringify(api.configuration(token))};
       if(path==='/member/recovery/configuration/prepare'&&request.method==='POST')return {status:200,body:JSON.stringify(api.prepareConfiguration(token,body))};
       if(path==='/member/recovery/configuration/submit'&&request.method==='POST')return {status:200,body:JSON.stringify(await api.configure(token,body))};
       if(path==='/member/recovery/requests'&&request.method==='GET')return {status:200,body:JSON.stringify(api.listRequests(token))};
       if(path==='/member/recovery/requests'&&request.method==='POST')return {status:201,body:JSON.stringify(api.createRequest(token,body))};
       if(path==='/member/recovery/log'&&request.method==='GET')return {status:200,body:JSON.stringify(api.log(token))};
       const requestMatch=/^\/member\/recovery\/requests\/([a-f0-9-]{36})(?:\/(prepare|approve))?$/.exec(path);
       if(requestMatch){const [,id,action]=requestMatch;if(!action&&request.method==='GET')return {status:200,body:JSON.stringify(api.readRequest(token,id!))};if(action==='prepare'&&request.method==='POST')return {status:200,body:JSON.stringify(api.prepareApproval(token,id!,body))};if(action==='approve'&&request.method==='POST')return {status:200,body:JSON.stringify(await api.approve(token,id!,body))};}
       return {status:405,body:JSON.stringify({error:'method_not_allowed'})};
      }
      if(privateNode){
       const id=privateNode[1];
       if(!id&&request.method!=='GET')return {status:405,body:JSON.stringify({error:'method_not_allowed'})};
       const token=request.headers.get('authorization')?.match(/^Bearer (amr1_[A-Za-z0-9_-]{43})$/)?.[1];
       if(!token)return {status:401,body:JSON.stringify({error:'unauthorised'})};
       const api=openPrivateNode(r);
       if(!id)return {status:200,body:JSON.stringify(api.list(token))};
       if(request.method==='GET')return {status:200,body:JSON.stringify(api.read(token,id))};
       if(!inputBody||typeof inputBody!=='object'||Array.isArray(inputBody)||Object.keys(inputBody).sort().join(',')!=='envelope,expectedRevision')throw new PrivateNodeError(400,'invalid_private_record');
       const supplied=inputBody as {expectedRevision:unknown;envelope:unknown};
       return {status:200,body:JSON.stringify(api.write(token,id,supplied.expectedRevision,supplied.envelope))};
      }
      if(permissionRequest){
       const [,id,decision]=permissionRequest;
       if(request.method!==(decision?'POST':'GET'))return {status:405,body:JSON.stringify({error:'method_not_allowed'})};
       const token=request.headers.get('authorization')?.match(/^Bearer (amr1_[A-Za-z0-9_-]{43})$/)?.[1];
       if(!token)return {status:401,body:JSON.stringify({error:'unauthorised'})};
       const api=openPermissionRequests(r);
       if(decision&&(!inputBody||typeof inputBody!=='object'||Array.isArray(inputBody)||Object.keys(inputBody).join(',')!=='digest'||typeof (inputBody as {digest:unknown}).digest!=='string'))throw new Error('Permission request unavailable');
       const value=decision?api.decide(token,id!,(inputBody as {digest:string}).digest,decision as 'grant'|'cancel'):id?api.read(token,id):api.list(token);
       return {status:200,body:JSON.stringify(value)};
      }
      if(permission){
       const listing=permission[1]==='list';
       if(request.method!==(listing?'GET':'POST'))return {status:405,body:JSON.stringify({error:'method_not_allowed'})};
       const token=request.headers.get('authorization')?.match(/^Bearer (amr1_[A-Za-z0-9_-]{43})$/)?.[1];
       if(!token)return {status:401,body:JSON.stringify({error:'unauthorised'})};
       const session=r.authority.sessionPrincipal(token);if(!session)throw new Error('Permission unavailable');
       const ledger=new PermissionLedger(store),at=now();
       if(listing)return {status:200,body:JSON.stringify({household:session.household,checkedAt:at,permissions:ledger.forHousehold(session.household)})};
       if(!inputBody||typeof inputBody!=='object'||Array.isArray(inputBody)||Object.keys(inputBody).join(',')!=='permission')throw new Error('Permission unavailable');
       const id=(inputBody as {permission:unknown}).permission;
       if(typeof id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id))throw new Error('Permission unavailable');
       const held=ledger.forHousehold(session.household).find(p=>p.id===id);if(!held)throw new Error('Permission unavailable');
       // A lost response may be retried without changing the original revocation time.
       const revoked=held.revoked_at===null?ledger.revoke(session.household,id,at):held;
       return {status:200,body:JSON.stringify({household:session.household,permission:revoked})};
      }
      const token=request.headers.get('authorization')?.match(/^Bearer (amr1_[A-Za-z0-9_-]{43})$/)?.[1];if(!token)return {status:401,body:JSON.stringify({error:'unauthorised'})};
      if(mandateEffective || mandateChanges){
       const api=openMandateChanges(r,{rpID:c.rpID});
       if(mandateEffective){if(request.method!=='GET')return {status:405,body:JSON.stringify({error:'method_not_allowed'})};return {status:200,body:JSON.stringify(api.effective(token))};}
       const [,id,action]=mandateChanges!;
       const expected=id?(action===undefined||action==='prepare'?'GET':'POST'):(request.method==='GET'?'GET':'POST');
       if(request.method!==expected)return {status:405,body:JSON.stringify({error:'method_not_allowed'})};
       if(!id&&request.method==='GET')return {status:200,body:JSON.stringify(api.list(token))};
       if(id&&!action)return {status:200,body:JSON.stringify(api.read(token,id))};
       if(id&&action==='prepare')return {status:200,body:JSON.stringify(api.prepareSignature(token,id))};
       if(id&&action==='cancel'){
        if(!inputBody||typeof inputBody!=='object'||Array.isArray(inputBody)||Object.keys(inputBody).length)throw badRequest('invalid_cancellation','Invalid mandate cancellation');
        return {status:200,body:JSON.stringify(api.cancel(token,id))};
       }
       if(id&&action==='submit'){
        if(!inputBody||typeof inputBody!=='object'||Array.isArray(inputBody)||Object.keys(inputBody).join(',')!=='assertion')throw badRequest('invalid_signature','Invalid mandate signature');
        return {status:200,body:JSON.stringify(api.submit(token,id,(inputBody as {assertion:Assertion}).assertion))};
       }
       if(!id&&request.method==='POST'){
        if(!inputBody||typeof inputBody!=='object'||Array.isArray(inputBody)||Object.keys(inputBody).join(',')!=='mandate')throw badRequest('invalid_mandate','Invalid mandate change');
        const draft=(inputBody as {mandate:unknown}).mandate;
        if(!draft||typeof draft!=='object'||Array.isArray(draft)||Object.keys(draft).sort().join(',')!=='ceiling_daily,ceiling_out_of_network,co_signers,cooling_seconds,household,id,lapses_at,version')throw badRequest('invalid_mandate','Invalid mandate change');
        return {status:201,body:JSON.stringify(api.prepare(token,draft as import('../../engine/src/hub/mandates.ts').Mandate))};
       }
       throw new Error('Mandate change unavailable');
      }
      const action=mandate?('mandate-'+mandate[1]):(prepare||digital||withdrawal)?'prepare':match![2]??'review',method=['review','outcome'].includes(action)?'GET':'POST';
      if(request.method!==method)return {status:405,body:JSON.stringify({error:'method_not_allowed'})};
      // §16.1, question 56. Signing a mandate that arrived by a move. It sits
      // beside the statement ceremony because it is the same shape: the device
      // is shown what it is agreeing to, and the engine verifies the assertion.
      if(mandate){
       if(action==='mandate-submit'&&(!inputBody||typeof inputBody!=='object'||!['assertion','assertion,mandate'].includes(Object.keys(inputBody).sort().join(','))))throw new Error('Invalid assertion');
       if(['mandate-prepare','mandate-list'].includes(action)&&(!inputBody||typeof inputBody!=='object'||Array.isArray(inputBody)||!['','mandate'].includes(Object.keys(inputBody).join(','))))throw new Error('Invalid request');
       const ceremony=openMandateCeremony(r,{rpID:c.rpID});
       const named=(inputBody as {mandate?:unknown}).mandate;if(named!==undefined&&typeof named!=='string')throw new Error('Invalid mandate');
       const value=action==='mandate-list'?ceremony.list(token):action==='mandate-prepare'?ceremony.prepare(token,named):ceremony.submit(token,(inputBody as {assertion:Assertion}).assertion,named);
       return {status:200,body:JSON.stringify(value)};
      }
      if(withdrawal || (match && (await r.journal.read(token,match[1]!)).kind==='digital_withdrawal')){
       const api=openWithdrawalAuthorisations(r,{environment:c.environment,origin:c.origin,rpID:c.rpID,maximumLifetimeMs:c.maximumLifetimeMs,now});
       if(action==='submit'&&(!inputBody||typeof inputBody!=='object'||Object.keys(inputBody).join(',')!=='assertion'))throw new Error('Invalid assertion');
       if(action==='cancel'&&(!inputBody||typeof inputBody!=='object'||Array.isArray(inputBody)||Object.keys(inputBody).length))throw new Error('Invalid cancellation');
       const value=await(action==='prepare'?api.prepare(token,inputBody as {decisionOperationID:string}):action==='review'?api.read(token,match![1]!):action==='outcome'?api.outcome(token,match![1]!):action==='cancel'?api.cancel(token,match![1]!):api.submit(token,match![1]!,(inputBody as {assertion:PreparedAssertion}).assertion));
       return {status:200,body:JSON.stringify(value)};
      }
      if(digital || (match && (await r.journal.read(token,match[1]!)).kind==='digital_decision')){
       const api=openDecisionAuthorisations(r,{environment:c.environment,origin:c.origin,rpID:c.rpID,maximumLifetimeMs:c.maximumLifetimeMs,now});
       if(action==='submit'&&(!inputBody||typeof inputBody!=='object'||Object.keys(inputBody).join(',')!=='assertion'))throw new Error('Invalid assertion');
       if(action==='cancel'&&(!inputBody||typeof inputBody!=='object'||Array.isArray(inputBody)||Object.keys(inputBody).length))throw new Error('Invalid cancellation');
       const value=await(action==='prepare'?api.prepare(token,inputBody as {offer:string;decisions:DecisionInput[]}):action==='review'?api.read(token,match![1]!):action==='outcome'?api.outcome(token,match![1]!):action==='cancel'?api.cancel(token,match![1]!):api.submit(token,match![1]!,(inputBody as {assertion:PreparedAssertion}).assertion));
       return {status:200,body:JSON.stringify(value)};
      }
      const api=openStatementAuthorisations(r,{environment:c.environment,origin:c.origin,rpID:c.rpID,maximumLifetimeMs:c.maximumLifetimeMs,maxSessionLifetimeMs:c.maxSessionLifetimeMs,engine:r.engine.config,now});
      if(action==='submit'&&(!inputBody||typeof inputBody!=='object'||Object.keys(inputBody).join(',')!=='assertion'))throw new Error('Invalid assertion');
      if(action==='cancel'&&(!inputBody||typeof inputBody!=='object'||Array.isArray(inputBody)||Object.keys(inputBody).length))throw new Error('Invalid cancellation');
      const value=await (action==='prepare'?api.prepare(token,inputBody as {offer:string;disputed:string[]}):action==='review'?api.read(token,match![1]!):action==='outcome'?api.outcome(token,match![1]!):action==='cancel'?api.cancel(token,match![1]!):api.settle(token,match![1]!,(inputBody as {assertion:PreparedAssertion}).assertion));
      return {status:200,body:JSON.stringify(value)};
     }
     const hub={quotes:r.quotes,deliveries:r.deliveries,registry:new Registry(store),recovery:new RecoveryRegister(store),approvals:new ApprovalDesk(store),permissions:new PermissionLedger(store)};
     const read=memberReadBoundary({environment:c.environment,origin:c.origin,now,resolveSession:r.authority.resolveSession,ownerOf:async resource=>{
      let owner:{household:string;presenter?:string};try{if(resource.kind==='offer'){const o=r.engine.mustGet(resource.id);owner={household:o.household,presenter:o.presenter};}else owner={household:r.engine.mandates.mustGet(resource.id).household};}catch{r.authority.invalidateResource(resource);return;}
      try{r.authority.bindResource(resource,owner);}catch{r.authority.invalidateResource(resource);return;}return r.authority.ownerOf(resource);
     },next:createApp(r.engine,hub)});
     const reply=await memberTransport({...r,read,admit:async()=>true,maxBodyBytes:c.maximumBodyBytes})(fixed,context);
     return {status:reply.status,body:await reply.text()};
    });
    if(Buffer.byteLength(result.body)>1_048_576)return json(503,'response_unavailable');
    return new Response(result.status===204?null:result.body,{status:result.status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});
   }catch(error){if(recovery&&error instanceof MemberRecoveryError)return json(error.status,error.code);if(privateNode&&error instanceof PrivateNodeError)return json(error.status,error.code);if(mandateChanges&&error instanceof ValenceError)return json(error.status,error.code);return json((error as Error).message==='PostgreSQL writer fenced'||/^[A-Z0-9]{5}$/.test((error as {code?:string}).code??'')?503:member?404:503,'request_unavailable');}finally{pending--;}
  }
 };
}
