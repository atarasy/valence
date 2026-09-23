import { attachDatabasePool } from '@vercel/functions';
import { isIP } from 'node:net';
import { createPool } from '../store.ts';
import { openPostgresMemberHTTP } from '../http.ts';
import type { MemberRuntimeConfig } from '../config.ts';
const unavailable=()=>Response.json({error:'temporarily_unavailable'},{status:503,headers:{'cache-control':'no-store'}});
/**
 * Messages this package throws itself, on the path a cold start or a request
 * takes before `http.ts`'s own catch can turn it into a JSON response. A pg
 * driver error's message routinely carries the connection string's host and,
 * for an authentication failure, a fragment that looks like a password, so
 * only these fixed strings are ever printed whole. #41's minute of 503s
 * (2026-09-22) logged nothing at all, because the catch below discarded the
 * error entirely.
 */
const SAFE_STARTUP_MESSAGES=new Set([
 'Bound runtime mismatch', // http.ts: the running build's runtime profile no longer matches member_config/current
 'Deployment scope mismatch', // http.ts: the deployed identity's environment/origin does not match the runtime config
 'Hosted configuration unavailable', // this file: VERCEL!=='1' or DATABASE_URL missing
 'Invalid member runtime', // config.ts: memberRuntimeIdentity() rejected the shape of config.json
 'Invalid member runtime limits', // config.ts: a numeric limit in config.json is not a positive safe integer
 'PostgreSQL writer fenced', // store.ts: the control row is missing, disabled, or at a different epoch/scope
 'PostgreSQL snapshot limit', // store.ts: the deployment's row count or byte size exceeds the bound
 'Invalid PostgreSQL identity', // store.ts: DEPLOYMENT_ID/environment/origin/epoch fail the identity() check
 'Invalid or duplicate PostgreSQL map', // store.ts: a namespace name is malformed or opened twice in one run
 'Invalid PostgreSQL value', // store.ts: a value written to the store is not JSON-encodable within the size cap
]);
/** Pure so a startup failure can be reasoned about, and tested, without a live deployment to reproduce it against. */
export function failureReason(error:unknown):string {
 if(error instanceof Error&&SAFE_STARTUP_MESSAGES.has(error.message))return error.message;
 const code=(error as {code?:unknown}|null)?.code;
 if(typeof code==='string'&&/^[A-Za-z0-9]{5}$/.test(code))return 'database error '+code;
 if(error instanceof Error&&error.name)return error.name;
 return 'unknown';
}
/**
 * One target's fetch handler. Each target has its own entry file importing only
 * its own configuration and AASA, so a production bundle carries nothing of the
 * development origin or app identifier, and the reverse.
 */
export function memberEntry(deploymentID:string,config:MemberRuntimeConfig,aasa:unknown,pages:Readonly<Record<string,string>>={}){
const c=config,identity={id:deploymentID,environment:c.environment,origin:c.origin,epoch:1};
let app:Promise<Awaited<ReturnType<typeof openPostgresMemberHTTP>>>|undefined;
function runtime(){
 if(app)return app;
 if(process.env.VERCEL!=='1'||!process.env.DATABASE_URL)throw new Error('Hosted configuration unavailable');
 const pool=createPool(process.env.DATABASE_URL);pool.on('error',()=>{console.error('Member database idle connection unavailable');});attachDatabasePool(pool);
 const pending=openPostgresMemberHTTP(pool,identity,c);app=pending;
 void pending.catch(async()=>{app=undefined;await pool.end().catch(()=>{});});return pending;
}
return {async fetch(request:Request){
 try{
  const url=new URL(request.url);
  if(url.origin!==c.origin)return Response.json({error:'request_unavailable'},{status:403});
  // Vercel-controlled header; this entry is only valid behind the Vercel ingress.
  const peer=request.headers.get('x-vercel-forwarded-for')??'';
  if(!isIP(peer))return unavailable();
  if(url.pathname==='/.well-known/apple-app-site-association'){
   if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405});
   return new Response(request.method==='HEAD'?null:JSON.stringify(aasa),{status:200,headers:{'content-type':'application/json','cache-control':'public, max-age=3600','x-content-type-options':'nosniff'}});
  }
  // Static, unauthenticated pages (the App Store privacy and support URLs), answered before the runtime is opened.
  if(Object.hasOwn(pages,url.pathname)){
   if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405});
   return new Response(request.method==='HEAD'?null:pages[url.pathname]!,{status:200,headers:{'content-type':'text/html; charset=utf-8','cache-control':'public, max-age=3600','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'"}});
  }
  return await (await runtime()).fetch(request,{peer});
 }catch(error){console.error('Member API unavailable: '+failureReason(error));return unavailable();}
}};
}
