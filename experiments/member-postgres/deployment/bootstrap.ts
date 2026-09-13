import { migrateDatabase } from '../migrate.ts';
import { createPool,initialiseDeployment } from '../store.ts';
import { openPostgresMemberHTTP } from '../http.ts';
import type { MemberRuntimeConfig } from '../config.ts';
import config from './config.json';
// Explicit operator command for this newly provisioned, development-only project.
if(process.env.NEON_PROJECT_ID!=='young-pond-73223516'||!process.env.DATABASE_URL_UNPOOLED)throw new Error('Expected dedicated Atarasy development database');
await migrateDatabase(process.env.DATABASE_URL_UNPOOLED);
const pool=createPool(process.env.DATABASE_URL_UNPOOLED),c=config as MemberRuntimeConfig;
try{
 const identity={id:'atarasy_api_dev',environment:c.environment,origin:c.origin,epoch:1};
 await initialiseDeployment(pool,identity);await openPostgresMemberHTTP(pool,identity,c);
 console.log('Atarasy development schema and runtime identity initialised; no member fixtures provisioned');
}finally{await pool.end();}
