import {openSync,writeFileSync,closeSync,unlinkSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {createPool,postgresStore,StoreError} from '../store.ts';
import {ValenceError} from '../../../engine/src/common/errors.ts';
import {ReviewInvitationError,issueReviewInvitation} from '../review-invitation.ts';
import {TARGETS,TargetError,targetDatabaseURL,assertTargetDatabase} from './targets.ts';
// Production only, and there is no `--target`: the invitation this issues is a
// real member's, so it is never pointed at the development database.
const [action,output,...extra]=process.argv.slice(2);
if(action!=='issue'||extra.length||!output||!isAbsolute(output))throw new Error('Usage: member-invite.ts issue /absolute/private/new-invitation.json');
const target=TARGETS.production,c=target.config;
const url=targetDatabaseURL(target,process.env);
const pool=createPool(url),unit=postgresStore(pool,{id:target.deploymentID,environment:c.environment,origin:c.origin,epoch:1});
try{
 await assertTargetDatabase(pool,target);
 // Exclusive creation refuses existing files and symlinks; the token is never printed.
 const fd=openSync(output,'wx',0o600);
 try{
  const invitation=await unit.run(s=>issueReviewInvitation(s,c));
  writeFileSync(fd,JSON.stringify({origin:c.origin,token:invitation.token,expiresAt:invitation.expiresAt})+'\n');
  console.log(JSON.stringify({issued:true,principal:invitation.principal,expiresAt:invitation.expiresAt}));
 }catch(error){
  // No token reached the file, and an empty one would only make the next `issue` fail EEXIST.
  closeSync(fd);unlinkSync(output);throw error;
 }
 closeSync(fd);
}catch(error){
 // The same allow-list as device-acceptance.ts: a driver error's text can hold a host or a role name.
 const ours=(error instanceof ReviewInvitationError||error instanceof ValenceError||error instanceof StoreError||error instanceof TargetError)&&typeof error.message==='string';
 console.error('Review invitation failed; nothing is retried automatically. Reason: '+(ours?(error as Error).message:'unknown (the failure did not come from this tool)'));
 process.exitCode=1;
}finally{await pool.end();}
