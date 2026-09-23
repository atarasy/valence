import {test,expect} from 'bun:test';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {TARGETS,parseTarget,targetDatabaseURL,assertTargetDatabase} from './targets.ts';
import {migrateDatabase} from '../migrate.ts';
import {createPool,initialiseDeployment} from '../store.ts';

test('each target reads only its own Neon project, in both directions',()=>{
 const url='postgres://example.invalid/db';
 expect(targetDatabaseURL(TARGETS.production,{NEON_PROJECT_ID:'weathered-violet-85512339',DATABASE_URL_UNPOOLED:url})).toBe(url);
 expect(targetDatabaseURL(TARGETS.development,{NEON_PROJECT_ID:'young-pond-73223516',DATABASE_URL_UNPOOLED:url})).toBe(url);
 expect(()=>targetDatabaseURL(TARGETS.production,{NEON_PROJECT_ID:'young-pond-73223516',DATABASE_URL_UNPOOLED:url})).toThrow('production');
 expect(()=>targetDatabaseURL(TARGETS.development,{NEON_PROJECT_ID:'weathered-violet-85512339',DATABASE_URL_UNPOOLED:url})).toThrow('development');
 expect(()=>targetDatabaseURL(TARGETS.production,{DATABASE_URL_UNPOOLED:url})).toThrow();
 expect(()=>targetDatabaseURL(TARGETS.production,{NEON_PROJECT_ID:'weathered-violet-85512339'})).toThrow();
});

test('the targets differ exactly where they must',()=>{
 const d=TARGETS.development,p=TARGETS.production;
 expect(p).toMatchObject({deploymentID:'atarasy_api_prod',neonProjectID:'weathered-violet-85512339',aasa:{webcredentials:{apps:['83W4J65UE6.com.vox.atarasy']}}});
 expect(p.config).toEqual({...d.config,environment:'production',origin:'https://members.vox.delivery',rpID:'members.vox.delivery',androidAppOrigins:[]});
 expect(d.deploymentID).not.toBe(p.deploymentID);expect(d.neonProjectID).not.toBe(p.neonProjectID);
});

test('the target flag defaults to development and refuses anything else',()=>{
 expect(parseTarget(['/tmp/out'])).toEqual({target:TARGETS.development,rest:['/tmp/out']});
 expect(parseTarget(['--target','production','/tmp/out'])).toEqual({target:TARGETS.production,rest:['/tmp/out']});
 expect(()=>parseTarget(['--target'])).toThrow();
 expect(()=>parseTarget(['--target','staging','/tmp/out'])).toThrow('Unknown target');
});

test('a database holding one target\'s deployment refuses the other, in both directions',async()=>{
 const base=process.env.ATARASY_TEST_POSTGRES_URL;if(!base)throw new Error('Isolated PostgreSQL URL required');
 const admin=new Pool({connectionString:base}),names=['tgt_'+randomUUID().replaceAll('-',''),'tgt_'+randomUUID().replaceAll('-','')];
 const at=(name:string)=>{const u=new URL(base);u.pathname='/'+name;return u.toString();};
 try{
  for(const n of names)await admin.query(`CREATE DATABASE ${n}`);
  const pairs=[[TARGETS.development,TARGETS.production],[TARGETS.production,TARGETS.development]] as const;
  for(const [i,[holder,other]] of pairs.entries()){
   const pool=createPool(at(names[i]!));
   try{
    // Fresh: no control table yet, both pass.
    await assertTargetDatabase(pool,holder);await assertTargetDatabase(pool,other);
    await migrateDatabase(at(names[i]!));
    const c=holder.config;await initialiseDeployment(pool,{id:holder.deploymentID,environment:c.environment,origin:c.origin,epoch:1});
    await assertTargetDatabase(pool,holder);
    await expect(assertTargetDatabase(pool,other)).rejects.toThrow('another target');
   }finally{await pool.end();}
  }
 }finally{
  for(const n of names)await admin.query(`DROP DATABASE IF EXISTS ${n} WITH (FORCE)`);
  await admin.end();
 }
},60000);
