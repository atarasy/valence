import {openSync,writeFileSync,closeSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {createPool,postgresStore} from '../store.ts';
import {prepareDeviceAcceptance,deviceAcceptanceStatus,inviteDeviceAcceptance} from '../device-acceptance.ts';
import type {MemberRuntimeConfig} from '../config.ts';
import config from './config.json';
const [action,output,...extra]=process.argv.slice(2);
if(!['prepare','status','invite'].includes(action??'')||extra.length||(action==='invite'?(!output||!isAbsolute(output)):output!==undefined))throw new Error('Usage: device-acceptance.ts prepare | status | invite /absolute/private/new-file.json');
if(process.env.NEON_PROJECT_ID!=='young-pond-73223516'||!process.env.DATABASE_URL_UNPOOLED)throw new Error('Dedicated development database required');
const c=config as MemberRuntimeConfig,pool=createPool(process.env.DATABASE_URL_UNPOOLED),unit=postgresStore(pool,{id:'atarasy_api_dev',environment:c.environment,origin:c.origin,epoch:1});
try{
 if(action==='prepare')console.log(JSON.stringify(await unit.run(s=>prepareDeviceAcceptance(s,c))));
 else if(action==='status')console.log(JSON.stringify(await unit.run(s=>deviceAcceptanceStatus(s,c))));
 else{
  // Exclusive creation refuses existing files and symlinks; no token on stdout.
  const fd=openSync(output!,'wx',0o600);
  try{
   const invitation=await unit.run(s=>inviteDeviceAcceptance(s,c));
   writeFileSync(fd,JSON.stringify(invitation)+'\n');
   console.log(JSON.stringify({issued:true,expiresAt:invitation.expiresAt}));
  }finally{closeSync(fd);}
 }
}catch{console.error('Acceptance command failed; inspect status before retrying. No automatic retry.');process.exitCode=1;}
finally{await pool.end();}
