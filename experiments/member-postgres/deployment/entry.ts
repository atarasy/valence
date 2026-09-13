import { attachDatabasePool } from '@vercel/functions';
import { isIP } from 'node:net';
import { createPool } from '../store.ts';
import { openPostgresMemberHTTP } from '../http.ts';
import type { MemberRuntimeConfig } from '../config.ts';
import config from './config.json';
const c=config as MemberRuntimeConfig;
const identity={id:'atarasy_api_dev',environment:c.environment,origin:c.origin,epoch:1};
const unavailable=()=>Response.json({error:'temporarily_unavailable'},{status:503,headers:{'cache-control':'no-store'}});
let app:Promise<Awaited<ReturnType<typeof openPostgresMemberHTTP>>>|undefined;
function runtime(){
 if(app)return app;
 if(process.env.VERCEL!=='1'||!process.env.DATABASE_URL)throw new Error('Hosted configuration unavailable');
 const pool=createPool(process.env.DATABASE_URL);pool.on('error',()=>{console.error('Member database idle connection unavailable');});attachDatabasePool(pool);
 const pending=openPostgresMemberHTTP(pool,identity,c);app=pending;
 void pending.catch(async()=>{app=undefined;await pool.end().catch(()=>{});});return pending;
}
export default {async fetch(request:Request){
 try{
  const url=new URL(request.url);
  if(url.origin!==c.origin)return Response.json({error:'request_unavailable'},{status:403});
  // Vercel-controlled header; this entry is only valid behind the Vercel ingress.
  const peer=request.headers.get('x-vercel-forwarded-for')??'';
  if(!isIP(peer))return unavailable();
  if(url.pathname==='/.well-known/apple-app-site-association')return Response.json({error:'association_pending_signed_app_verification'},{status:503,headers:{'cache-control':'no-store'}});
  return await (await runtime()).fetch(request,{peer});
 }catch{return unavailable();}
}};
