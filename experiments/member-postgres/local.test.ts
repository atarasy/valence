import {test,expect,afterAll} from 'bun:test';
import {createServer} from 'node:net';
import {randomUUID,generateKeyPairSync} from 'node:crypto';
import {createPool,postgresStore} from './store.ts';
import {memberRuntime} from './runtime.ts';
import {registerPresenter} from './presenter-http.ts';
import {assertLocalDatabaseUrl,LOCAL_DEPLOYMENT_ID} from './local-shared.ts';
import {startLocalServer} from './local.ts';

function freePort():Promise<number> {
 return new Promise((resolve,reject)=>{
  const srv=createServer();
  srv.on('error',reject);
  srv.listen(0,'127.0.0.1',()=>{const address=srv.address();const port=typeof address==='object'&&address?address.port:0;srv.close(()=>resolve(port));});
 });
}

async function cleanupLocalDeployment(url:string) {
 const pool=createPool(url);
 try{await pool.query('DELETE FROM atarasy_member.engine_rows WHERE deployment=$1',[LOCAL_DEPLOYMENT_ID]);await pool.query('DELETE FROM atarasy_member.control WHERE id=$1',[LOCAL_DEPLOYMENT_ID]);}
 catch{/* schema not migrated yet; startLocalServer's own migration creates it */}
 finally{await pool.end();}
}

const restoreEnv:(()=>void)[]=[];
function setEnv(name:string,value:string) {
 const previous=process.env[name];restoreEnv.push(()=>{if(previous===undefined)delete process.env[name];else process.env[name]=previous;});
 process.env[name]=value;
}
afterAll(()=>{for(const restore of restoreEnv.splice(0))restore();});

test('assertLocalDatabaseUrl accepts loopback and unix-socket forms, refuses everything else',()=>{
 expect(()=>assertLocalDatabaseUrl('postgres://127.0.0.1:5432/atarasy_local')).not.toThrow();
 expect(()=>assertLocalDatabaseUrl('postgres://localhost:5432/atarasy_local')).not.toThrow();
 expect(()=>assertLocalDatabaseUrl('postgresql://127.0.0.1:5432/atarasy_local')).not.toThrow();
 expect(()=>assertLocalDatabaseUrl('postgres:///atarasy_local?host=/tmp/pgsock-example')).not.toThrow();
 expect(()=>assertLocalDatabaseUrl('postgres://ep-cool-lab-123.us-east-2.aws.neon.tech/db')).toThrow('127.0.0.1');
 expect(()=>assertLocalDatabaseUrl('postgres://db.example.com:5432/prod')).toThrow('127.0.0.1');
 expect(()=>assertLocalDatabaseUrl('postgres://127.0.0.1.evil.example/db')).toThrow('127.0.0.1');
 expect(()=>assertLocalDatabaseUrl('http://127.0.0.1:5432/db')).toThrow('postgres://');
 expect(()=>assertLocalDatabaseUrl('not a url')).toThrow();
});

test('the local server refuses to start against a non-local database',async()=>{
 setEnv('LOCAL_DATABASE_URL','postgres://db.example.com:5432/prod');
 setEnv('PORT',String(await freePort()));
 await expect(startLocalServer()).rejects.toThrow('127.0.0.1');
});

test('the local server answers /presenter/self 401 without a token and 200 with the issued one',async()=>{
 const url=process.env.ATARASY_TEST_POSTGRES_URL;
 if(!url)throw new Error('Explicit ATARASY_TEST_POSTGRES_URL required; tests do not use application credentials');
 await cleanupLocalDeployment(url);
 setEnv('LOCAL_DATABASE_URL',url);
 setEnv('PORT',String(await freePort()));
 let handle:Awaited<ReturnType<typeof startLocalServer>>|undefined;
 try{
  handle=await startLocalServer();
  const origin=handle.config.origin;

  const unauthorised=await fetch(origin+'/presenter/self');
  expect(unauthorised.status).toBe(401);

  const presenterKey=generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'}).toString();
  const merchantKey=generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'}).toString();
  const presenter='local-presenter-'+randomUUID(),merchant='local-merchant-'+randomUUID();
  const unit=postgresStore(handle.pool,handle.identity);
  const issued=await unit.run(s=>registerPresenter(memberRuntime(s,handle!.config),{presenter,presenterName:'OPS-01 walkthrough',presenterKey,merchant,merchantKey,at:Date.now()}));

  const authorised=await fetch(origin+'/presenter/self',{headers:{authorization:`Bearer ${issued.token}`}});
  expect(authorised.status).toBe(200);
  expect(await authorised.json()).toMatchObject({presenter,displayName:'OPS-01 walkthrough'});

  const wrongToken=await fetch(origin+'/presenter/self',{headers:{authorization:'Bearer apr1_'+'0'.repeat(43)}});
  expect(wrongToken.status).toBe(401);
 }finally{
  handle?.server.stop(true);
  await handle?.pool.end();
  await cleanupLocalDeployment(url);
 }
},30000);

// OPS-01 widened the https-only origin checks for one case. These pin how
// narrow it is: the exception needs the environment to be exactly `local` AND
// the origin to be http on the loopback literal; each half alone still fails.
test('the http exception is only a `local` environment on http://127.0.0.1',async()=>{
 const base=(await import('./deployment/config.json')).default as import('./config.ts').MemberRuntimeConfig;
 const {memberRuntimeIdentity}=await import('./config.ts');
 const at=(environment:string,origin:string)=>()=>memberRuntimeIdentity({...base,environment,origin,rpID:new URL(origin).hostname});
 expect(at('local','http://127.0.0.1:8788')).not.toThrow();
 expect(at('development','http://127.0.0.1:8788')).toThrow();
 expect(at('production','http://127.0.0.1:8788')).toThrow();
 expect(at('local','http://localhost:8788')).toThrow();
 expect(at('local','http://api-dev.vox.delivery')).toThrow();
 expect(at('local','https://api-dev.vox.delivery')).not.toThrow();
 const pool=createPool('postgres://127.0.0.1:1/unused');
 try{
  const identity=(environment:string,origin:string)=>()=>postgresStore(pool,{id:'x',environment,origin,epoch:1});
  expect(identity('local','http://127.0.0.1:8788')).not.toThrow();
  expect(identity('development','http://127.0.0.1:8788')).toThrow();
  expect(identity('local','http://10.0.0.1:8788')).toThrow();
 }finally{await pool.end();}
});
