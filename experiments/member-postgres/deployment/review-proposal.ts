import {createPool,postgresStore,StoreError} from '../store.ts';
import {ValenceError} from '../../../engine/src/common/errors.ts';
import {ReviewInvitationError} from '../review-invitation.ts';
import {proposeForReview} from '../review-proposal.ts';
import {TARGETS,TargetError,targetDatabaseURL,assertTargetDatabase} from './targets.ts';
// Production only, like member-invite.ts. Run once to adopt the household and write the
// mandate claim, let the reviewer's device sign it, then run again to present the proposal.
const [action,principal,...extra]=process.argv.slice(2);
if(action!=='propose'||extra.length||!principal||!/^review_member_[a-f0-9]{32}$/.test(principal))throw new Error('Usage: review-proposal.ts propose <review_member_... principal printed by member-invite.ts>');
const target=TARGETS.production,c=target.config;
const url=targetDatabaseURL(target,process.env);
const pool=createPool(url),unit=postgresStore(pool,{id:target.deploymentID,environment:c.environment,origin:c.origin,epoch:1});
try{
 await assertTargetDatabase(pool,target);
 console.log(JSON.stringify(await unit.run(s=>proposeForReview(s,c,principal))));
}catch(error){
 // The same allow-list as member-invite.ts: a driver error's text can hold a host or a role name.
 const ours=(error instanceof ReviewInvitationError||error instanceof ValenceError||error instanceof StoreError||error instanceof TargetError)&&typeof error.message==='string';
 console.error('Review proposal failed; nothing is retried automatically. Reason: '+(ours?(error as Error).message:'unknown (the failure did not come from this tool)'));
 process.exitCode=1;
}finally{await pool.end();}
