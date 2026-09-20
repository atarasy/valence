import { createHash, randomUUID } from 'node:crypto';
import { PermissionLedger } from '../../engine/src/hub/permissions.ts';
import { records } from './records.ts';
import type { memberRuntime } from './runtime.ts';

type Runtime = ReturnType<typeof memberRuntime>;
type Terms = {
 profile: 'atarasy.permission-review.1'; requestID: string; household: string;
 action: string; requester: { id: string; name: string }; purpose: string;
 fields: { id: 'duplicate_check'; label: string }[];
 createdAt: number; reviewExpiresAt: number; accessExpiresAt: number;
};
type RequestRecord = { terms: Terms; digest: string; actionID: string; product: string; privateDigest: string; state: 'pending'|'granted'|'cancelled'; permissionID: string|null; decidedAt: number|null };
const unavailable=()=>new Error('Permission request unavailable');
const text=(v:unknown):v is string=>typeof v==='string'&&v.trim()===v&&v.length>0&&v.length<=512&&!/[\u0000-\u001f\u007f]/.test(v);
const digest=(terms:Terms)=>createHash('sha256').update(JSON.stringify(terms)).digest('hex');
const privateDigest=(publicDigest:string,product:string)=>createHash('sha256').update(JSON.stringify(['atarasy.permission-request-private.1',publicDigest,product])).digest('hex');
/** Trusted issuer only. No HTTP route creates requests or supplies grant terms. */
export function openPermissionRequests(r:Runtime,ledger=new PermissionLedger(r.path.store)) {
 const rows=records<RequestRecord>(r.path,'member_permission_requests');
 function principal(token:string){const session=r.authority.sessionPrincipal(token);if(!session)throw unavailable();return session;}
 function valid(row:RequestRecord){if(row.digest!==digest(row.terms)||row.privateDigest!==privateDigest(row.digest,row.product))throw unavailable();return row;}
 function owned(token:string,id:string){const session=principal(token),row=rows.get(id);if(!row||row.terms.household!==session.household)throw unavailable();return valid(row);}
 function view(row:RequestRecord){
  const permission=row.permissionID===null?null:ledger.forHousehold(row.terms.household).find(p=>p.id===row.permissionID);
  if(permission===undefined)throw unavailable();
  return {terms:row.terms,digest:row.digest,state:row.state==='pending'&&row.terms.reviewExpiresAt<=r.now()?'expired':row.state,decidedAt:row.decidedAt,permission};
 }
 return {
  issueDuplicateCheck(input:{household:string;product:string;productName:string;requester:{id:string;name:string};reviewExpiresAt:number;accessExpiresAt:number}) {
   const at=r.now();
   if(!text(input.household)||!text(input.product)||!text(input.productName)||!text(input.requester?.id)||!text(input.requester?.name)||input.requester.id===input.household||!Number.isSafeInteger(at)||!Number.isSafeInteger(input.reviewExpiresAt)||!Number.isSafeInteger(input.accessExpiresAt)||input.reviewExpiresAt<=at||input.accessExpiresAt<input.reviewExpiresAt)throw unavailable();
   // The field and its description are fixed by this supported action, never by a member payload.
   const terms:Terms={profile:'atarasy.permission-review.1',requestID:randomUUID(),household:input.household,action:`Check whether you already have ${input.productName}`,requester:{id:input.requester.id,name:input.requester.name},purpose:'Avoid proposing a gift you already have',fields:[{id:'duplicate_check',label:'Whether you already have a product'}],createdAt:at,reviewExpiresAt:input.reviewExpiresAt,accessExpiresAt:input.accessExpiresAt};
   const publicDigest=digest(terms),row:RequestRecord={terms,digest:publicDigest,actionID:ledger.openAction({household:input.household,describes:terms.action,expiresAt:input.reviewExpiresAt}).id,product:input.product,privateDigest:privateDigest(publicDigest,input.product),state:'pending',permissionID:null,decidedAt:null};
   rows.insert(terms.requestID,row);return view(row);
  },
  list(token:string){const session=principal(token),requests:ReturnType<typeof view>[]=[];rows.each(row=>{if(row.terms.household===session.household)requests.push(view(valid(row)));});return {household:session.household,checkedAt:r.now(),requests};},
  read(token:string,id:string){return view(owned(token,id));},
  decide(token:string,id:string,reviewDigest:string,decision:'grant'|'cancel') {
   return r.path.transaction(()=>{
    const row=owned(token,id);
    if(row.digest!==reviewDigest||!['grant','cancel'].includes(decision))throw unavailable();
    const state=decision==='grant'?'granted':'cancelled';
    if(row.state===state)return view(row);
    if(row.state!=='pending'||row.terms.reviewExpiresAt<=r.now())throw unavailable();
    if(decision==='grant'){
     const permission=ledger.grant({household:row.terms.household,grantee:row.terms.requester.id,scope:row.terms.fields.map(f=>f.id),purpose:row.terms.purpose,expires_at:row.terms.accessExpiresAt,asked_from:row.actionID,now:r.now()});
     row.permissionID=permission.id;
    }
    row.state=state;row.decidedAt=r.now();rows.put(id,row);return view(row);
   })();
  },
  duplicateCheck(requester:string,id:string) {
   return r.path.transaction(()=>{
    const row=rows.get(id);if(!row||valid(row).terms.requester.id!==requester||row.state!=='granted'||!row.permissionID)throw unavailable();
    const permission=ledger.forHousehold(row.terms.household).find(p=>p.id===row.permissionID);
    if(!permission||!ledger.allows({household:row.terms.household,grantee:requester,field:'duplicate_check',now:r.now()}))throw unavailable();
    const answered=r.engine.hasBeenGiven(row.terms.household,row.product);
    ledger.recordQuery({household:row.terms.household,asked_by:requester,product:row.product,asked_from:row.actionID,answered,now:r.now()});
    return {already_received:answered};
   })();
  }
 };
}
