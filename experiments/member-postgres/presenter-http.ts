import {createHash,randomBytes} from 'node:crypto';
import {createApp,type Hub} from '../../engine/src/http.ts';
import {records} from './records.ts';
import type {memberRuntime} from './runtime.ts';
type Runtime=ReturnType<typeof memberRuntime>;
type Credential={presenter:string;revoked:number;issuedAt:number};
type Reply={status:number;body:string};
const TOKEN=/^apr1_[A-Za-z0-9_-]{43}$/;
const reply=(status:number,body:unknown):Reply=>({status,body:JSON.stringify(body)});
function identifier(value:unknown,what:string):asserts value is string{
 if(typeof value!=='string'||!value||value.length>512||/[\u0000-\u001f\u007f]/.test(value))throw new Error('Invalid '+what);
}
/**
 * Development presenter credentials. The reference engine authenticates
 * nobody (SPEC §7.2, deferred), so its presenter routes cannot be exposed on a
 * public origin as they are. A credential names exactly one presenter and is
 * stored only as a digest scoped to this deployment.
 */
export function presenterCredentials(r:Runtime){
 const rows=records<Credential>(r.path,'member_presenter_credentials'),scope=r.path.scope;
 const digest=(token:string)=>createHash('sha256').update(JSON.stringify(['atarasy.presenter-credential.1',scope.environment,scope.audience,token])).digest('hex');
 return {
  resolve(token:string){if(!TOKEN.test(token))return;const row=rows.get(digest(token));return row&&row.revoked===0?row.presenter:undefined;},
  issue(presenter:string,at:number){
   identifier(presenter,'presenter');
   // The key must already be an identity: a credential for a presenter nobody can verify would publish catalogues that never register.
   if(!r.engine.publicKeyFor(presenter))throw new Error('Presenter identity not registered');
   const token='apr1_'+randomBytes(32).toString('base64url');
   rows.insert(digest(token),{presenter,revoked:0,issuedAt:at});
   return {presenter,token};
  },
 };
}
/**
 * Trusted operator capability. Registering a key as an identity is clause 2's
 * root and not a presenter's act, so it happens here and never through the
 * presenter surface. Re-registering the same key is accepted; another key for
 * the same name is refused by the engine.
 */
export function registerPresenter(r:Runtime,input:{presenter:string;presenterKey:string;merchant:string;merchantKey:string;at:number}){
 identifier(input.merchant,'merchant');
 r.engine.registerIdentity(input.presenter,input.presenterKey);
 r.engine.registerIdentity(input.merchant,input.merchantKey);
 return presenterCredentials(r).issue(input.presenter,input.at);
}
function object(value:unknown):Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};}
/**
 * The presenter surface of the development deployment. Every route resolves
 * the credential to one presenter and refuses anything belonging to another:
 * a catalogue must name it, a disclosure must be for a merchant its catalogue
 * sells, an offer must use its catalogue, and every per-offer action must be
 * on its own offer. Validation of the bodies themselves stays the engine's.
 */
export async function presenterRequest(r:Runtime,hub:Hub,request:Request,input:unknown):Promise<Reply>{
 const token=request.headers.get('authorization')?.match(/^Bearer (apr1_[A-Za-z0-9_-]{43})$/)?.[1];
 const presenter=token?presenterCredentials(r).resolve(token):undefined;
 if(!presenter)return reply(401,{error:'unauthorised',message:'a valid presenter credential is required'});
 const url=new URL(request.url),parts=url.pathname.split('/').filter(Boolean).slice(1),method=request.method,app=createApp(r.engine,hub);
 const forward=async(path:string,body?:unknown,verb=method):Promise<Reply>=>{
  const res=await app(new Request(url.origin+path,{method:verb,headers:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}));
  return {status:res.status,body:await res.text()};
 };
 const b=object(input);
 if(parts.length===1&&parts[0]==='self'&&method==='GET')return reply(200,{presenter});
 if(parts.length===1&&parts[0]==='configs'&&method==='POST'){
  if(b.presenter!==presenter)return reply(403,{error:'presenter_mismatch',message:'a catalogue must name the presenter this credential belongs to'});
  return forward('/_presenter/configs',input);
 }
 if(parts.length===1&&parts[0]==='disclosures'&&method==='POST'){
  const sells=r.engine.configsForPresenter(presenter).some(c=>Object.values(c.products).some(p=>p.merchant===b.merchant));
  if(!sells)return reply(403,{error:'merchant_not_in_catalogue',message:'publish a catalogue naming this merchant before its disclosure'});
  return forward('/_disclosures',input);
 }
 if(parts[0]!=='offers')return reply(404,{error:'request_unavailable'});
 if(parts.length===1&&method==='GET'){
  const household=url.searchParams.get('household');
  if(!household||[...url.searchParams.keys()].some(k=>k!=='household'))return reply(400,{error:'malformed',message:'household is required and is the only query'});
  return forward('/offers?household='+encodeURIComponent(household)+'&presenter='+encodeURIComponent(presenter),undefined,'GET');
 }
 if(parts.length===1&&method==='POST'){
  if(typeof b.config_version!=='string'||!r.engine.configsForPresenter(presenter).some(c=>c.version===b.config_version))
   return reply(403,{error:'catalogue_not_this_presenter',message:'an offer must use a catalogue this presenter published'});
  const created=await forward('/offers',input);
  if(created.status===201){
   const offer=JSON.parse(created.body) as {id:string;household:string};
   // The member read boundary needs ownership; binding it at creation means the household can read the offer at once.
   r.authority.bindResource({kind:'offer',id:offer.id},{household:offer.household,presenter});
  }
  return created;
 }
 const id=parts[1]!;
 let owner:string;
 try{owner=r.engine.mustGet(id).presenter;}catch{owner='';}
 // Another presenter's offer answers exactly as an absent one, so a credential learns nothing about offers it does not own.
 if(owner!==presenter)return reply(404,{error:'offer_unavailable',message:'no such offer for this presenter'});
 if(parts.length===2&&method==='GET'){
  const offer=await forward('/offers/'+encodeURIComponent(id),undefined,'GET');
  if(offer.status!==200)return offer;
  const delivery=r.deliveries.find(id);
  // Clause 49 and §7.5b: the carrier code resolves to an address, so the merchant sees carriage and status only.
  return reply(200,{offer:JSON.parse(offer.body),delivery:delivery?{carriage:delivery.carriage,status:delivery.status}:null,recovery:r.engine.recoveries.for(id)??null,settlement:r.engine.settlement(id)??null});
 }
 if(parts.length===3&&method==='POST'){
  if(parts[2]==='present')return forward('/offers/'+encodeURIComponent(id)+'/present',input);
  if(parts[2]==='recovery')return forward('/offers/'+encodeURIComponent(id)+'/recovery',input);
  if(parts[2]==='delivery'){
   if(Object.keys(b).sort().join(',')!=='carriage,status')return reply(400,{error:'malformed',message:'delivery takes carriage and status'});
   const recorded=await forward('/offers/'+encodeURIComponent(id)+'/delivery',{carriage:b.carriage,status:b.status,code:'dev-'+randomBytes(8).toString('hex')});
   if(recorded.status!==201)return recorded;
   return reply(201,{offer:id,carriage:b.carriage,status:b.status});
  }
 }
 return reply(404,{error:'request_unavailable'});
}
