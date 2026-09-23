import {test,expect,afterAll} from 'bun:test';
import {createServer} from 'node:net';
import {randomUUID,generateKeyPairSync,sign} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPool,postgresStore} from './store.ts';
import {memberRuntime} from './runtime.ts';
import {registerPresenter} from './presenter-http.ts';
import {assertLocalDatabaseUrl,LOCAL_DEPLOYMENT_ID} from './local-shared.ts';
import {startLocalServer} from './local.ts';
import {canonicalConfig} from '../../engine/src/engine/offers.ts';
import {canonicalDisclosure} from '../../engine/src/shared/disclosure.ts';

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

function invokeCLI(cliPath:string,args:string[],env:Record<string,string>) {
 return (async()=>{
  const child=Bun.spawn([process.execPath,cliPath,...args],{env:{PATH:process.env.PATH!,...env},stdout:'pipe',stderr:'pipe'});
  const [out,err,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
  return {out,err,code};
 })();
}

test('local-household.ts refuses a non-local database',async()=>{
 const cli=new URL('./local-household.ts',import.meta.url).pathname;
 const refused=await invokeCLI(cli,['create','ops01-presenter','/tmp/local-household-unused.json'],{LOCAL_DATABASE_URL:'postgres://db.example.com:5432/prod'});
 expect(refused.code).not.toBe(0);
 expect(refused.err).toContain('127.0.0.1');
});

// The composition OPS-01 needs, because no passkey can enrol against
// `127.0.0.1` (README, "No passkey ceremony works here"): `local-household.ts`
// writes the same rows a real enrolment and adoption would, and a presenter
// credential issued for the presenter it was granted can offer to the
// household it made and present that offer, exactly as a real deployment's
// presenter surface requires (presenter-http.test.ts's own fixture).
test('a household local-household.ts creates can be offered to by its granted presenter and presented',async()=>{
 const url=process.env.ATARASY_TEST_POSTGRES_URL;
 if(!url)throw new Error('Explicit ATARASY_TEST_POSTGRES_URL required; tests do not use application credentials');
 await cleanupLocalDeployment(url);
 setEnv('LOCAL_DATABASE_URL',url);
 const port=await freePort();setEnv('PORT',String(port));
 let handle:Awaited<ReturnType<typeof startLocalServer>>|undefined,dir:string|undefined;
 try{
  handle=await startLocalServer();
  const presenterPair=generateKeyPairSync('ed25519'),merchantPair=generateKeyPairSync('ed25519');
  const pem=(pair:{publicKey:{export:(o:any)=>any}})=>pair.publicKey.export({type:'spki',format:'pem'}).toString();
  const unit=postgresStore(handle.pool,handle.identity);
  const issued=await unit.run(store=>registerPresenter(memberRuntime(store,handle!.config),{presenter:'ops01-presenter',presenterName:'OPS-01 walkthrough',presenterKey:pem(presenterPair),merchant:'ops01-merchant',merchantKey:pem(merchantPair),at:Date.now()}));

  dir=mkdtempSync(join(tmpdir(),'local-household-'));
  const output=join(dir,'household.json');
  const cli=new URL('./local-household.ts',import.meta.url).pathname;
  const created=await invokeCLI(cli,['create','ops01-presenter',output],{LOCAL_DATABASE_URL:url,PORT:String(port)});
  expect(created.code).toBe(0);expect(created.err).toBe('');
  const printed=JSON.parse(created.out);
  expect(printed).toEqual({household:expect.stringMatching(/^key:/),mandate:expect.stringMatching(/^key:.*\.1$/)});
  const written=JSON.parse(readFileSync(output,'utf8'));
  expect(written).toMatchObject({household:printed.household,mandate:printed.mandate});
  expect(written.privateKeyPem).toContain('BEGIN PRIVATE KEY');

  const send=(path:string,body?:unknown,method?:string)=>fetch(handle!.config.origin+path,{method:method??(body===undefined?'GET':'POST'),headers:{'content-type':'application/json',authorization:'Bearer '+issued.token},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const configBody={version:'ops01-1',presenter:'ops01-presenter',products:{'ops01-tea':{merchant:'ops01-merchant',maker:'ops01-maker',ships:'ops01-carrier',price:1200,physical:{ambient:true,keeps_for_days:365,fits_ten_per_container:true,regulated:false}}}};
  expect((await send('/presenter/configs',{...configBody,signature:sign(null,canonicalConfig(configBody),presenterPair.privateKey).toString('base64')})).status).toBe(201);
  const disclosureBody={merchant:'ops01-merchant',product:null,version:'d-1',items:[{label:'notice',value:'test'}]};
  expect((await send('/presenter/disclosures',{...disclosureBody,signature:sign(null,canonicalDisclosure(disclosureBody),merchantPair.privateKey).toString('base64')})).status).toBe(201);
  const offerBody={binding:'physical',household:written.household,purpose:'replenish',config_version:'ops01-1',expires_at:Date.now()+86_400_000,mandate:written.mandate,price_band:null,giver:null,candidates:[{product:'ops01-tea',quantity:1,predicted_conversion:0.5,is_exploration:true,given_by:null}]};
  const offerCreated=await send('/presenter/offers',offerBody);
  expect(offerCreated.status).toBe(201);
  const offer=await offerCreated.json() as {id:string};
  expect((await send('/presenter/offers/'+offer.id+'/present',{})).status).toBe(200);
 }finally{
  if(dir)rmSync(dir,{recursive:true,force:true});
  handle?.server.stop(true);
  await handle?.pool.end();
  await cleanupLocalDeployment(url!);
 }
},30000);
