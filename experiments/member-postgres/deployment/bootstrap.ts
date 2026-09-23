import { migrateDatabase } from '../migrate.ts';
import {parseTarget,targetDatabaseURL,assertTargetDatabase} from './targets.ts';
import { createPool,initialiseDeployment } from '../store.ts';
import { openPostgresMemberHTTP } from '../http.ts';
// Explicit operator command: `bun deployment/bootstrap.ts [--target development|production]`.
const {target,rest}=parseTarget(process.argv.slice(2));
if(rest.length)throw new Error('Usage: bootstrap.ts [--target development|production]');
const url=targetDatabaseURL(target,process.env);
const check=createPool(url);
try{await assertTargetDatabase(check,target);}finally{await check.end();}
await migrateDatabase(url);
const pool=createPool(url),c=target.config;
try{
 const identity={id:target.deploymentID,environment:c.environment,origin:c.origin,epoch:1};
 await initialiseDeployment(pool,identity);await openPostgresMemberHTTP(pool,identity,c);
 console.log(`Atarasy ${target.name} schema and runtime identity initialised; no member fixtures provisioned`);
}finally{await pool.end();}
