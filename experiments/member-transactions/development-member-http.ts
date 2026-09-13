import { createHash } from 'node:crypto';
import { openMemberHTTP, inputBody, type MemberRuntimeConfig } from './member-http.ts';
import { openAtomicStore } from './atomic-store.ts';
import { openMemberAuthority } from '../member-read/authority.ts';
import { openVerifiedLogin } from '../member-login/login.ts';
import { openEnrollment } from '../member-login/enrollment.ts';
import { memberTransport } from '../member-login/transport.ts';
import { memberReadBoundary } from '../member-read/gate.ts';
import { createApp } from '../../engine/src/http.ts';
import { ValenceEngine } from '../../engine/src/engine/offers.ts';
import { InMemoryLedger } from '../../engine/src/engine/ledger.ts';
import { LocalDeliveries } from '../../engine/src/engine/delivery-source.ts';
import { DeliveryRegister } from '../../engine/src/hub/delivery.ts';
import { RecoveryRegister } from '../../engine/src/hub/node.ts';
import { ApprovalDesk } from '../../engine/src/hub/approval.ts';
import { PermissionLedger } from '../../engine/src/hub/permissions.ts';
import { Registry } from '../../engine/src/shared/registry.ts';
const json = (status:number,error:string) => Response.json({error},{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
const authPaths = ['/auth/enrollment/options','/auth/enrollment/verify','/auth/login/options','/auth/login/verify','/auth/session','/auth/logout'];
/** Caller supplies a trusted transport peer, never X-Forwarded-For. No listener starts here. */
export async function openDevelopmentMemberHTTP(path:string,input:MemberRuntimeConfig) {
 const operations = await openMemberHTTP(path,input), c = Object.freeze(structuredClone(input));
 const unit = openAtomicStore(operations.descriptor.path,{environment:c.environment,audience:c.origin});
 const runtime = (database: Parameters<Parameters<typeof unit.run>[0]>[1]) => {
  const authority = openMemberAuthority(database,{environment:c.environment,audience:c.origin,maxSessionLifetimeMs:c.maxSessionLifetimeMs});
  const login = openVerifiedLogin(database,authority,{environment:c.environment,origin:c.origin,rpID:c.rpID,challengeLifetimeMs:c.maximumLifetimeMs,sessionLifetimeMs:c.maxSessionLifetimeMs});
  const enrollment = openEnrollment(database,authority,login,{environment:c.environment,origin:c.origin,rpID:c.rpID,rpName:'Atarasy',invitationLifetimeMs:c.maximumLifetimeMs,challengeLifetimeMs:c.maximumLifetimeMs});
  return {authority,login,enrollment};
 };
 try { await unit.run((_store,db)=>{ runtime(db); }); } catch(error) { unit.close(); operations.close(); throw error; }
 let pending=0,closed=false,tail:Promise<unknown>=Promise.resolve();
 const peers = new Map<string,{expires:number;used:number}>();
 return {
  descriptor:Object.freeze({...operations.descriptor,composition:'atarasy.development-member-http.1'}),
  prepareCutover:operations.prepareCutover, activateCutover:operations.activateCutover,
  async fetch(request:Request,context:{peer:string}):Promise<Response> {
   const url=new URL(request.url);
   if(url.origin!==c.origin||url.username||url.password||url.hash||request.headers.has('cookie')||(request.headers.has('origin')&&request.headers.get('origin')!==c.origin)||['cross-site','same-site'].includes(request.headers.get('sec-fetch-site')??''))return json(403,'request_unavailable');
   const member=url.pathname.startsWith('/member/');
   const known=member||authPaths.includes(url.pathname)||url.pathname==='/offers'||/^\/offers\/[A-Za-z0-9_-]+(?:\/(approval|statement|settlement))?$/.test(url.pathname)||/^\/_node\/mandates\/[A-Za-z0-9_-]+$/.test(url.pathname);
   if(!known)return json(404,'request_unavailable');
   if(closed||pending>=c.maximumPending||typeof context?.peer!=='string'||!context.peer||context.peer.length>256)return json(503,'unavailable');
   const at=Date.now(),key=createHash('sha256').update(context.peer).digest('hex');
   for(const [k,v] of peers)if(v.expires<=at)peers.delete(k);
   let budget=peers.get(key);if(!budget){if(peers.size>=c.maximumTrackedTokens)return json(503,'unavailable');budget={expires:at+c.budgetWindowMs,used:0};peers.set(key,budget);}
   if(budget.used>=c.maximumRequests)return json(429,'rate_limited');budget.used++;pending++;
   try {
    if(!['GET','POST'].includes(request.method))return json(405,'method_not_allowed');
    let bytes:string|undefined;
    if(request.method==='POST'){
     if(request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')return json(400,'invalid_body');
     try { bytes=JSON.stringify(await inputBody(request,c.maximumBodyBytes,c.bodyTimeoutMs)); } catch { return json(400,'invalid_body'); }
    }
    if(request.signal.aborted)return json(400,'request_aborted');
    const fixed=new Request(request.url,{method:request.method,headers:request.headers,...(bytes===undefined?{}:{body:bytes})});
    const work=tail.then(async()=>{
     if(member){const reply=await operations.fetch(fixed);return {status:reply.status,headers:[...reply.headers],body:new Uint8Array(await reply.arrayBuffer())};}
     return unit.run(async(store,db)=>{
      const {authority,login,enrollment}=runtime(db);
      const engine=new ValenceEngine(new InMemoryLedger(store),{explorationRate:c.explorationRate,reminderLimit:c.reminderLimit,recoveryGraceDays:c.recoveryGraceDays,relyingPartyId:c.rpID,memberStatementScope:{environment:c.environment,origin:c.origin}},store);
      const hub={registry:new Registry(store),recovery:new RecoveryRegister(store),approvals:new ApprovalDesk(store),permissions:new PermissionLedger(store),deliveries:new DeliveryRegister(store)};
      engine.readDeliveriesFrom(new LocalDeliveries(hub.deliveries));
      const read=memberReadBoundary({environment:c.environment,origin:c.origin,resolveSession:authority.resolveSession,ownerOf:async resource=>{
       let owner:{household:string;presenter?:string};
       try {
        if(resource.kind==='offer'){const record=engine.mustGet(resource.id);owner={household:record.household,presenter:record.presenter};}
        else {owner={household:engine.mandates.mustGet(resource.id).household};}
       }catch{authority.invalidateResource(resource);return undefined;}
       try {authority.bindResource(resource,owner);}catch{authority.invalidateResource(resource);return undefined;}
       return authority.ownerOf(resource);
      },next:createApp(engine,hub)});
      const reply=await memberTransport({authority,login,enrollment,read,admit:async()=>true,maxBodyBytes:c.maximumBodyBytes})(fixed,{peer:context.peer});
      const body=new Uint8Array(await reply.arrayBuffer());if(body.length>1_048_576)throw new Error('Response limit');
      // Refusals commit ceremony consumption; credential activation has its own savepoint.
      return {status:reply.status,headers:[...reply.headers],body};
     });
    });
    tail=work.catch(()=>{});const reply=await work;
    const headers=new Headers(reply.headers as [string,string][]);headers.set('cache-control','no-store');headers.set('x-content-type-options','nosniff');
    return new Response(reply.status===204?null:reply.body,{status:reply.status,headers});
   }catch{return json(503,'unavailable');}finally{pending--;}
  },
  close(){if(pending)throw new Error('Member requests still active');if(!closed){closed=true;unit.close();operations.close();peers.clear();}},
 };
}
