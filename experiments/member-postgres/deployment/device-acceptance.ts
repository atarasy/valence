import {openSync,writeFileSync,closeSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {createPool,postgresStore} from '../store.ts';
import {ValenceError} from '../../../engine/src/common/errors.ts';
import {AcceptanceError,prepareDeviceAcceptance,deviceAcceptanceStatus,inviteDeviceAcceptance,prepareStatementAcceptance,prepareStatementBox,grantVoxPresenter,retireUnprovenCredentials} from '../device-acceptance.ts';
import type {MemberRuntimeConfig} from '../config.ts';
import config from './config.json';
const [action,output,...extra]=process.argv.slice(2);
const needs=action==='invite'?'path':action==='vox'?'presenter':'none';
if(!['prepare','status','invite','statement','box','retire','vox'].includes(action??'')||extra.length||(needs==='path'?(!output||!isAbsolute(output)):needs==='presenter'?!output:output!==undefined))throw new Error('Usage: device-acceptance.ts prepare | status | statement | box | retire | vox <presenter> | invite /absolute/private/new-file.json');
if(process.env.NEON_PROJECT_ID!=='young-pond-73223516'||!process.env.DATABASE_URL_UNPOOLED)throw new Error('Dedicated development database required');
const c=config as MemberRuntimeConfig,pool=createPool(process.env.DATABASE_URL_UNPOOLED),unit=postgresStore(pool,{id:'atarasy_api_dev',environment:c.environment,origin:c.origin,epoch:1});
try{
 if(action==='prepare')console.log(JSON.stringify(await unit.run(s=>prepareDeviceAcceptance(s,c))));
 else if(action==='status')console.log(JSON.stringify(await unit.run(s=>deviceAcceptanceStatus(s,c))));
 else if(action==='statement')console.log(JSON.stringify(await unit.run(s=>prepareStatementAcceptance(s,c))));
 else if(action==='box')console.log(JSON.stringify(await unit.run(s=>prepareStatementBox(s,c))));

 else if(action==='retire')console.log(JSON.stringify(await unit.run(s=>retireUnprovenCredentials(s,c))));
 else if(action==='vox')console.log(JSON.stringify(await unit.run(s=>grantVoxPresenter(s,c,output!))));
 else{
  // Exclusive creation refuses existing files and symlinks; no token on stdout.
  const fd=openSync(output!,'wx',0o600);
  try{
   const invitation=await unit.run(s=>inviteDeviceAcceptance(s,c));
   writeFileSync(fd,JSON.stringify(invitation)+'\n');
   console.log(JSON.stringify({issued:true,expiresAt:invitation.expiresAt}));
  }finally{closeSync(fd);}
 }
}catch(error){
 // Print the reason. A bare catch printed a fixed line and discarded the
 // message, so DEVICE_ACCEPTANCE.md named diagnoses the operator could never see.
 // Only this tool's own reasons. A driver error carries `code` or `severity`
 // and its text has held a role name and a connection failure, so it is not
 // printed: a fourth refutation pass measured `password authentication failed
 // for user ...` reaching the operator's terminal through a bare message read.
 // An allow-list of two classes, not a guess. Guessing from `code` hid every
 // engine refusal including `name_is_not_the_key`, which is the last thing
 // standing behind the household rule; guessing from the constructor printed
 // the driver's own text for the failures `pg` raises as a plain `Error`.
 const ours=(error instanceof AcceptanceError||error instanceof ValenceError)&&typeof error.message==='string';
 const reason=ours?error.message:'unknown (the failure did not come from this tool)';
 console.error('Acceptance command failed; inspect status before retrying. No automatic retry. Reason: '+reason);
 process.exitCode=1;}
finally{await pool.end();}
