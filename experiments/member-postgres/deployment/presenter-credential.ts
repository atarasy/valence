import {openSync,readFileSync,writeFileSync,closeSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {createPublicKey} from 'node:crypto';
import {createPool,postgresStore} from '../store.ts';
import {memberRuntime} from '../runtime.ts';
import {registerPresenter} from '../presenter-http.ts';
import type {MemberRuntimeConfig} from '../config.ts';
import config from './config.json';
import {DEPLOYMENT_ID} from './identity.ts';
const [action,presenter,presenterName,presenterKeyPath,merchant,merchantKeyPath,output,...extra]=process.argv.slice(2);
const paths=[presenterKeyPath,merchantKeyPath,output];
if(action!=='issue'||extra.length||!presenter||!presenterName||!merchant||paths.some(p=>!p||!isAbsolute(p)))throw new Error('Usage: presenter-credential.ts issue <presenter> <display-name> /abs/presenter.pem <merchant> /abs/merchant.pem /abs/private/new-credential.json');
if(process.env.NEON_PROJECT_ID!=='young-pond-73223516'||!process.env.DATABASE_URL_UNPOOLED)throw new Error('Dedicated development database required');
// Parse before connecting, so a wrong file fails without touching the database.
const pem=(path:string)=>createPublicKey(readFileSync(path,'utf8')).export({type:'spki',format:'pem'}).toString();
const presenterKey=pem(presenterKeyPath!),merchantKey=pem(merchantKeyPath!);
const c=config as MemberRuntimeConfig,pool=createPool(process.env.DATABASE_URL_UNPOOLED),unit=postgresStore(pool,{id:DEPLOYMENT_ID,environment:c.environment,origin:c.origin,epoch:1});
try{
 // Exclusive creation refuses existing files and symlinks; the token is never printed.
 const fd=openSync(output!,'wx',0o600);
 try{
  const issued=await unit.run(s=>registerPresenter(memberRuntime(s,c),{presenter:presenter!,presenterName:presenterName!,presenterKey,merchant:merchant!,merchantKey,at:Date.now()}));
  writeFileSync(fd,JSON.stringify(issued)+'\n');
  console.log(JSON.stringify({issued:true,presenter:issued.presenter}));
 }finally{closeSync(fd);}
}catch{console.error('Presenter credential command failed; nothing is retried automatically.');process.exitCode=1;}
finally{await pool.end();}
