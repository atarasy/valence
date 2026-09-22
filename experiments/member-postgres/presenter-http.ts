import {createHash,randomBytes} from 'node:crypto';
import {createApp,type Hub} from '../../engine/src/http.ts';
import {exportMerchant} from '../../engine/src/hub/node.ts';
import {records} from './records.ts';
import type {memberRuntime} from './runtime.ts';
type Runtime=ReturnType<typeof memberRuntime>;
type Credential={presenter:string;displayName?:string;revoked:number;issuedAt:number};
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
  resolve(token:string){if(!TOKEN.test(token))return;const row=rows.get(digest(token));return row&&row.revoked===0?row:undefined;},
  issue(presenter:string,displayName:string,at:number){
   identifier(presenter,'presenter');identifier(displayName,'presenter display name');
   // The key must already be an identity: a credential for a presenter nobody can verify would publish catalogues that never register.
   if(!r.engine.publicKeyFor(presenter))throw new Error('Presenter identity not registered');
   const token='apr1_'+randomBytes(32).toString('base64url');
   rows.insert(digest(token),{presenter,displayName,revoked:0,issuedAt:at});
   return {presenter,displayName,token};
  },
 };
}
/**
 * Trusted operator capability. Registering a key as an identity is clause 2's
 * root and not a presenter's act, so it happens here and never through the
 * presenter surface. Re-registering the same key is accepted; another key for
 * the same name is refused by the engine.
 */
export function registerPresenter(r:Runtime,input:{presenter:string;presenterName:string;presenterKey:string;merchant:string;merchantKey:string;at:number}){
 identifier(input.merchant,'merchant');
 r.engine.registerIdentity(input.presenter,input.presenterKey);
 r.engine.registerIdentity(input.merchant,input.merchantKey);
 return presenterCredentials(r).issue(input.presenter,input.presenterName,input.at);
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
 const credential=token?presenterCredentials(r).resolve(token):undefined;
 if(!credential)return reply(401,{error:'unauthorised',message:'a valid presenter credential is required'});
 const presenter=credential.presenter;
 const url=new URL(request.url),parts=url.pathname.split('/').filter(Boolean).slice(1),method=request.method,app=createApp(r.engine,hub);
 const forward=async(path:string,body?:unknown,verb=method):Promise<Reply>=>{
  const res=await app(new Request(url.origin+path,{method:verb,headers:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}));
  return {status:res.status,body:await res.text()};
 };
 const b=object(input);
 if(parts.length===1&&parts[0]==='self'&&method==='GET')return reply(200,{presenter,...(credential.displayName?{displayName:credential.displayName}:{})});
 if(parts.length===1&&parts[0]==='permission-requests'&&method==='POST'){
  if(url.search||Object.keys(b).sort().join(',')!=='access_expires_at,household,product,product_name,review_expires_at')return reply(400,{error:'malformed',message:'a duplicate-check request has exact household, product, product_name and expiries'});
  if(!credential.displayName)return reply(409,{error:'presenter_name_required',message:'rotate this presenter credential with an operator-registered display name'});
  for(const key of ['household','product','product_name'])identifier(b[key],key);
  if(!Number.isSafeInteger(b.review_expires_at)||!Number.isSafeInteger(b.access_expires_at))return reply(400,{error:'malformed',message:'request expiries must be safe whole numbers'});
  if(!r.engine.configsForPresenter(presenter).some(c=>Object.hasOwn(c.products,b.product as string)))return reply(422,{error:'unknown_product',message:'the requested product is not in this presenter\'s catalogue'});
  const {openPermissionRequests}=await import('./permission-requests.ts');
  try{return reply(201,openPermissionRequests(r,hub.permissions).issueDuplicateCheck({household:b.household as string,product:b.product as string,productName:b.product_name as string,requester:{id:presenter,name:credential.displayName},reviewExpiresAt:b.review_expires_at as number,accessExpiresAt:b.access_expires_at as number}));}
  catch{return reply(422,{error:'request_unavailable',message:'the permission request could not be opened'});}
 }
 if(parts.length===3&&parts[0]==='permission-requests'&&parts[2]==='duplicate-check'&&method==='POST'){
  if(url.search||Object.keys(b).length)return reply(400,{error:'malformed',message:'duplicate check takes no body fields'});
  const {openPermissionRequests}=await import('./permission-requests.ts');
  try{return reply(200,openPermissionRequests(r,hub.permissions).duplicateCheck(presenter,parts[1]!));}
  catch{return reply(404,{error:'request_unavailable',message:'no granted live request is available'});}
 }
 // A shop needs its published catalogues back to compose a box after a restart; only its own are listed.
 if(parts.length===1&&parts[0]==='configs'&&method==='GET'){
  if(url.search)return reply(400,{error:'malformed',message:'this route takes no query'});
  return reply(200,{configs:r.engine.configsForPresenter(presenter).map(c=>({version:c.version,presenter:c.presenter,products:c.products}))});
 }
 if(parts.length===1&&parts[0]==='configs'&&method==='POST'){
  if(b.presenter!==presenter)return reply(403,{error:'presenter_mismatch',message:'a catalogue must name the presenter this credential belongs to'});
  return forward('/_presenter/configs',input);
 }
 if(parts.length===1&&parts[0]==='disclosures'&&method==='POST'){
  const sells=r.engine.configsForPresenter(presenter).some(c=>Object.values(c.products).some(p=>p.merchant===b.merchant));
  if(!sells)return reply(403,{error:'merchant_not_in_catalogue',message:'publish a catalogue naming this merchant before its disclosure'});
  return forward('/_disclosures',input);
 }
 // VOX-11 (vault `72`): the specification's merchant export for this credential's presenter and no other, returned
 // unchanged, with the two records this surface keeps beside the engine. A delivery's carrier code resolves to an
 // address (clause 49, §7.5b), so it is projected to carriage and status exactly as the offer read above does.
 if(parts.length===1&&parts[0]==='export'&&method==='GET'){
  if(url.search)return reply(400,{error:'malformed',message:'this route takes no query'});
  const protocol=exportMerchant(r.engine,presenter,r.now());
  const deliveries=protocol.offers.flatMap(o=>{const d=r.deliveries.find(o.id);return d?[{offer:o.id,carriage:d.carriage,status:d.status}]:[];});
  const carriage_quotes=protocol.offers.flatMap(o=>{const q=r.quotes.find(o.id);return q?[q]:[];});
  return reply(200,{protocol,deliveries,carriage_quotes});
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
  // §14.3. An offer goes only to a household this host holds a member for. A
  // merchant knows a departed household's identifier from its own export, and
  // an offer written to it would come back as history if the same key enrolled
  // again (refutation pass, 2026-09-22). Never-enrolled and departed answer
  // alike, so the refusal says nothing about whether a household left.
  if(typeof b.household!=='string'||!r.authority.holdsHousehold(b.household))
   return reply(404,{error:'household_unavailable',message:'no member for that household is held here'});
  const created=await forward('/offers',input);
  if(created.status===201){
   const offer=JSON.parse(created.body) as {id:string;household:string};
   // The member read boundary needs ownership; binding it at creation means the household can read the offer at once.
   r.authority.bindResource({kind:'offer',id:offer.id},{household:offer.household,presenter});
  }
  return created;
 }
 const id=parts[1]!;
 let owner:string,binding='';
 try{const found=r.engine.mustGet(id);owner=found.presenter;binding=found.binding;}catch{owner='';}
 // Another presenter's offer answers exactly as an absent one, so a credential learns nothing about offers it does not own.
 if(owner!==presenter)return reply(404,{error:'offer_unavailable',message:'no such offer for this presenter'});
 if(parts.length===2&&method==='GET'){
  const offer=await forward('/offers/'+encodeURIComponent(id),undefined,'GET');
  if(offer.status!==200)return offer;
  const delivery=r.deliveries.find(id);
  // Clause 49 and §7.5b: the carrier code resolves to an address, so the merchant sees carriage and status only.
  return reply(200,{offer:JSON.parse(offer.body),delivery:delivery?{carriage:delivery.carriage,status:delivery.status}:null,recovery:r.engine.recoveries.for(id)??null,settlement:r.engine.settlement(id)??null,carriage_quote:r.quotes.find(id)??null});
 }
 // §6.6, question 70. A shop reads its own offer's corrections exactly as it reads anything else about it: unchanged from the engine.
 if(parts.length===3&&parts[2]==='corrections'&&method==='GET')return forward('/offers/'+encodeURIComponent(id)+'/corrections',undefined,'GET');
 if(parts.length===3&&method==='POST'){
  if(parts[2]==='corrections'){
   // Forwarded as sent: the engine refuses an unknown field, a bad shape and a
   // bad signature itself, so a second copy of its key list here could only
   // drift from it (a mutation removing one measured nothing either way).
   return forward('/offers/'+encodeURIComponent(id)+'/corrections',input);
  }
  // §6.6a. A refund that came back, and its repayment, reach the engine as sent, as a correction does.
  if(parts[2]==='returns')return forward('/offers/'+encodeURIComponent(id)+'/returns',input);
  if(parts[2]==='carriage-quote'){
   if(url.search||Object.keys(b).sort().join(',')!=='carriage')return reply(400,{error:'malformed',message:'quotation takes only carriage and no query'});
   if(binding!=='digital')return reply(422,{error:'not_digital',message:'a pre-order quotation is for a digital offer'});
   if(!Number.isSafeInteger(b.carriage)||(b.carriage as number)<0)return reply(422,{error:'bad_carriage',message:'carriage must be a nonnegative safe whole number'});
   const offer=r.engine.mustGet(id,r.now()),held=r.quotes.find(id);
   // Exact retry returns the original row, including its timestamp, even after decision.
   if(held)return held.carriage===b.carriage?reply(200,held):reply(422,{error:'carriage_fixed',message:'the quoted carriage cannot change'});
   if(!['drafted','presented'].includes(offer.state)||offer.expires_at<=r.now())return reply(409,{error:'quote_unavailable',message:'quote before a live offer is decided'});
   return reply(201,r.quotes.record(id,b.carriage as number,r.now()));
  }
  if(parts[2]==='present')return forward('/offers/'+encodeURIComponent(id)+'/present',input);
  // A digital offer has no goods in a home. The engine records a delivery on one anyway, and the hub then
  // draws that carriage on the approval, so the presenter surface refuses both physical steps for it.
  if((parts[2]==='recovery'||parts[2]==='delivery')&&binding!=='physical')return reply(422,{error:'not_physical',message:'delivery and collection apply only to a physical box'});
  if(parts[2]==='recovery'){
   // A collection before any delivery holds the household's next box while settlement refuses with delivery_missing,
   // so nobody could clear it. Refuse it here instead.
   if(!r.deliveries.find(id))return reply(422,{error:'delivery_missing',message:'record the delivery before the collection'});
   // Completeness, `missing` and already-decided items are the engine's since question 46 (SPEC §11.2), so they are not repeated here.
   return forward('/offers/'+encodeURIComponent(id)+'/recovery',input);
  }
  if(parts[2]==='delivery'){
   if(Object.keys(b).sort().join(',')!=='carriage,status')return reply(400,{error:'malformed',message:'delivery takes carriage and status'});
   const recorded=await forward('/offers/'+encodeURIComponent(id)+'/delivery',{carriage:b.carriage,status:b.status,code:'dev-'+randomBytes(8).toString('hex')});
   if(recorded.status!==201)return recorded;
   return reply(201,{offer:id,carriage:b.carriage,status:b.status});
  }
 }
 return reply(404,{error:'request_unavailable'});
}
