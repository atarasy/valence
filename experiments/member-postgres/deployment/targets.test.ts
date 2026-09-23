import {test,expect} from 'bun:test';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {TARGETS,parseTarget,targetDatabaseURL,assertTargetConnection,assertTargetDatabase} from './targets.ts';
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

test('the connection guard checks the connection string the way pg itself reads it, not new URL(...).hostname',()=>{
 const real='postgres://user:pw@ep-curly-sound-b33yhpem.c-4.ap-southeast-1.aws.neon.tech/db?sslmode=verify-full';
 const pooled='postgres://user:pw@EP-Curly-Sound-B33yhpem-Pooler.c-4.ap-southeast-1.aws.neon.tech/db';
 const other='postgres://user:pw@ep-other-label-123.c-4.ap-southeast-1.aws.neon.tech/db';
 const shorterHost='postgres://user:pw@ep-curly-sound-b33yhpem.ap-southeast-1.aws.neon.tech/db';
 // The NEON_PROJECT_ID typed on the command line is not consulted here; only the URL is.
 expect(()=>assertTargetConnection(TARGETS.production,real)).not.toThrow();
 // Case-insensitive, and the pooled form is accepted too.
 expect(()=>assertTargetConnection(TARGETS.production,pooled)).not.toThrow();
 expect(()=>assertTargetConnection(TARGETS.production,other)).toThrow('production Neon endpoint');
 expect(()=>assertTargetConnection(TARGETS.production,'not a url')).toThrow('production Neon endpoint');
 // A prefix match is not a match: only the real, whole hostname passes.
 expect(()=>assertTargetConnection(TARGETS.production,shorterHost)).toThrow('production Neon endpoint');
 // Development is untouched: no endpoint id is recorded for it, so nothing here refuses it.
 expect(()=>assertTargetConnection(TARGETS.development,other)).not.toThrow();
 expect(()=>assertTargetConnection(TARGETS.development,'not a url')).not.toThrow();
});

test('the connection guard reads the connection the way pg actually connects, not the URL authority beside it',()=>{
 // The exact escape a refutation pass measured: `?host=` overrides the host
 // `pg` connects to while `new URL(...).hostname` still shows the authority.
 // A version of this guard using `new URL` passed this string and the pool
 // then connected to the local socket the query names, not the authority.
 const socketOverride='postgres://postgres@ep-curly-sound-b33yhpem.c-4.ap-southeast-1.aws.neon.tech:5432/t?host=/tmp/some-socket-dir';
 expect(()=>assertTargetConnection(TARGETS.production,socketOverride)).toThrow('production Neon endpoint');
 // The same shape with a second Neon host in the authority: an earlier version
 // of this guard compared only the first DNS label, so anything beginning
 // `ep-curly-sound-b33yhpem.` passed.
 const wrongRegion='postgres://user@ep-curly-sound-b33yhpem.evil.example/t';
 expect(()=>assertTargetConnection(TARGETS.production,wrongRegion)).toThrow('production Neon endpoint');
 const hostaddr='postgres://user@ep-curly-sound-b33yhpem.c-4.ap-southeast-1.aws.neon.tech/t?hostaddr=10.0.0.1';
 expect(()=>assertTargetConnection(TARGETS.production,hostaddr)).toThrow('hostaddr');
 const multiHost='postgres://user@ep-curly-sound-b33yhpem.c-4.ap-southeast-1.aws.neon.tech,evil.example/t';
 expect(()=>assertTargetConnection(TARGETS.production,multiHost)).toThrow('multiple hosts');
});

test('allowLocalTestConnection widens the guard to a local address only, never a remote host',()=>{
 const local='postgres://postgres@localhost:55481/t';
 const loopback='postgres://postgres@127.0.0.1:55481/t';
 const socket='postgres://postgres@ignored/t?host=/tmp/some-socket-dir';
 const remote='postgres://user@ep-other-label-123.c-4.ap-southeast-1.aws.neon.tech/db';
 for(const url of [local,loopback,socket]){
  expect(()=>assertTargetConnection(TARGETS.production,url)).toThrow();
  expect(()=>assertTargetConnection(TARGETS.production,url,{allowLocalTestConnection:true})).not.toThrow();
 }
 // The flag cannot launder a remote host, real endpoint or not.
 expect(()=>assertTargetConnection(TARGETS.production,remote,{allowLocalTestConnection:true})).toThrow('production Neon endpoint');
 // The env-var form of the same switch exists only for the spawned-CLI test,
 // which has no function call to pass the option through; it is a boolean,
 // not a value that could name an arbitrary label.
 const env=process.env.ATARASY_TEST_ALLOW_LOCAL_PRODUCTION_CONNECTION;
 try{
  process.env.ATARASY_TEST_ALLOW_LOCAL_PRODUCTION_CONNECTION='1';
  expect(()=>assertTargetConnection(TARGETS.production,local)).not.toThrow();
  expect(()=>assertTargetConnection(TARGETS.production,remote)).toThrow('production Neon endpoint');
 }finally{
  if(env===undefined)delete process.env.ATARASY_TEST_ALLOW_LOCAL_PRODUCTION_CONNECTION;else process.env.ATARASY_TEST_ALLOW_LOCAL_PRODUCTION_CONNECTION=env;
 }
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
