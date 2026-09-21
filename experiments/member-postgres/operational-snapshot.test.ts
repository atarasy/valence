import {beforeAll,afterAll,expect,test} from 'bun:test';
import {randomUUID} from 'node:crypto';
import {createPool,initialiseDeployment,postgresStore,type Identity} from './store.ts';
import {migrateDatabase} from './migrate.ts';
import {captureDeployment,restoreDeploymentCandidate} from './operational-snapshot.ts';
const url=process.env.ATARASY_TEST_POSTGRES_URL;if(!url)throw new Error('Explicit isolated ATARASY_TEST_POSTGRES_URL required');
const source=createPool(url),db='snapshot_'+randomUUID().replaceAll('-',''),targetURL=new URL(url);targetURL.pathname='/'+db;
const target=createPool(targetURL.toString()),ids:string[]=[],artifactDirectories:string[]=[];
beforeAll(async()=>{await migrateDatabase(url);await source.query(`CREATE DATABASE "${db}"`);await migrateDatabase(targetURL.toString());});
afterAll(async()=>{const {rmSync}=await import('node:fs');for(const directory of artifactDirectories)rmSync(directory,{recursive:true,force:true});await target.end();await source.query(`DROP DATABASE "${db}" WITH (FORCE)`);for(const id of ids){await source.query('DELETE FROM atarasy_member.engine_rows WHERE deployment=$1',[id]);await source.query('DELETE FROM atarasy_member.control WHERE id=$1',[id]);}await source.end();});
async function setup(){const identity:Identity={id:'snapshot_'+randomUUID().replaceAll('-',''),environment:'test',origin:'https://unit.example',epoch:1};ids.push(identity.id);await initialiseDeployment(source,identity);const unit=postgresStore(source,identity);await unit.run(store=>{store.map('snapshot_probe').set('second',{n:2});store.map('future_namespace').set('retained',{v:'unknown to snapshot code'});});return {identity,unit};}
test('all ordered bytes restore disabled and existing deployments cannot be overwritten',async()=>{const s=await setup(),snapshot=await captureDeployment(source,s.identity);const result=await restoreDeploymentCandidate(target,snapshot,s.identity);expect(result).toMatchObject({verified:true,enabled:false});const restored=await captureDeployment(target,s.identity);expect(restored.rows).toEqual(snapshot.rows);expect(restored.sourceEnabled).toBe(false);await expect(postgresStore(target,s.identity).run(()=>null)).rejects.toThrow('fenced');await expect(restoreDeploymentCandidate(target,snapshot,s.identity)).rejects.toThrow();expect((await captureDeployment(source,s.identity)).digest).toBe(snapshot.digest);});
test('wrong scope digest tampering and schema changes refuse before destination creation',async()=>{const s=await setup(),snapshot=await captureDeployment(source,s.identity);await expect(restoreDeploymentCandidate(target,snapshot,{...s.identity,epoch:2})).rejects.toThrow();const changed=structuredClone(snapshot);changed.rows[0]!.value='{}';await expect(restoreDeploymentCandidate(target,changed,s.identity)).rejects.toThrow();await target.query('CREATE TABLE atarasy_member.unrecognised (id int)');try{await expect(restoreDeploymentCandidate(target,snapshot,s.identity)).rejects.toThrow();}finally{await target.query('DROP TABLE atarasy_member.unrecognised');}expect((await target.query('SELECT 1 FROM atarasy_member.control WHERE id=$1',[s.identity.id])).rowCount).toBe(0);});
test('capture waits for an active writer and observes its complete committed state',async()=>{const s=await setup();let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r);const write=s.unit.run(async store=>{store.map('first').set('a',1);entered();await gate;store.map('last').set('z',2);});await started;let finished=false;const read=captureDeployment(source,s.identity).then(v=>{finished=true;return v;});try{await Bun.sleep(40);expect(finished).toBe(false);}finally{release();}await write;const result=await read;expect(result.rows.some(r=>r.namespace==='first')).toBe(true);expect(result.rows.some(r=>r.namespace==='last')).toBe(true);});
test('concurrent restorers create one candidate only',async()=>{const s=await setup(),snapshot=await captureDeployment(source,s.identity);const results=await Promise.allSettled([restoreDeploymentCandidate(target,snapshot,s.identity),restoreDeploymentCandidate(target,snapshot,s.identity)]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect((await captureDeployment(target,s.identity)).rows).toEqual(snapshot.rows);});
test('failure after the first restored row leaves neither candidate control nor partial state',async()=>{
 const s=await setup(),snapshot=await captureDeployment(source,s.identity);let inserts=0;
 const failing={async connect(){const c=await target.connect();return new Proxy(c,{get(client,key){if(key==='query')return async(...args:any[])=>{if(typeof args[0]==='string'&&args[0].startsWith('INSERT INTO atarasy_member.engine_rows')&&++inserts===2)throw new Error('injected write failure');return (client.query as any)(...args);};const value=Reflect.get(client,key);return typeof value==='function'?value.bind(client):value;}});}} as typeof target;
 await expect(restoreDeploymentCandidate(failing,snapshot,s.identity)).rejects.toThrow('injected write failure');
 expect(inserts).toBe(2);
 expect((await target.query('SELECT 1 FROM atarasy_member.control WHERE id=$1',[s.identity.id])).rowCount).toBe(0);
 expect((await target.query('SELECT 1 FROM atarasy_member.engine_rows WHERE deployment=$1',[s.identity.id])).rowCount).toBe(0);
 expect((await restoreDeploymentCandidate(target,snapshot,s.identity)).verified).toBe(true);
});

test('freezing returns a final snapshot and blocks every old writer including bootstrap',async()=>{
 const {freezeDeployment}=await import('./operational-snapshot.ts'),s=await setup(),ticket=randomUUID(),runtime='a'.repeat(64);
 const frozen=await freezeDeployment(source,s.identity,ticket,runtime);expect(frozen.sourceEnabled).toBe(false);
 await expect(s.unit.run(store=>store.map('snapshot_probe').set('late',3))).rejects.toThrow('fenced');
 await expect(initialiseDeployment(source,s.identity)).rejects.toThrow('fenced');
 expect(await freezeDeployment(source,s.identity,ticket,runtime)).toEqual(frozen);
 await expect(freezeDeployment(source,s.identity,randomUUID(),runtime)).rejects.toThrow();
 await expect(freezeDeployment(source,s.identity,ticket,'b'.repeat(64))).rejects.toThrow();
 expect((await restoreDeploymentCandidate(target,frozen,s.identity)).enabled).toBe(false);
});
test('freeze waits for committed writers and refuses a subsequent ticket',async()=>{
 const {freezeDeployment}=await import('./operational-snapshot.ts'),s=await setup();let release!:()=>void,entered!:()=>void;
 const gate=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r);
 const write=s.unit.run(async store=>{store.map('before_freeze').set('first',1);entered();await gate;store.map('at_freeze').set('last',2);});await started;
 let done=false;const a=freezeDeployment(source,s.identity,randomUUID(),'c'.repeat(64)).then(v=>{done=true;return v;});
 try{await Bun.sleep(40);expect(done).toBe(false);}finally{release();}await write;
 const frozen=await a;expect(frozen.rows.some(r=>r.namespace==='at_freeze')).toBe(true);
 await expect(freezeDeployment(source,s.identity,randomUUID(),'c'.repeat(64))).rejects.toThrow();
});
test('freeze failure after disabling source rolls back ticket and permits the original writer',async()=>{
 const {freezeDeployment}=await import('./operational-snapshot.ts'),s=await setup(),before=await captureDeployment(source,s.identity);let disabled=false;
 const failing={async connect(){const c=await source.connect();return new Proxy(c,{get(client,key){if(key==='query')return async(...args:any[])=>{if(disabled&&typeof args[0]==='string'&&args[0].startsWith('SELECT environment'))throw new Error('injected freeze readback failure');const result=await(client.query as any)(...args);if(typeof args[0]==='string'&&args[0].startsWith('UPDATE atarasy_member.control SET enabled=false'))disabled=true;return result;};const value=Reflect.get(client,key);return typeof value==='function'?value.bind(client):value;}});}} as typeof source;
 await expect(freezeDeployment(failing,s.identity,randomUUID(),'d'.repeat(64))).rejects.toThrow('injected freeze readback failure');expect(disabled).toBe(true);
 expect(await captureDeployment(source,s.identity)).toEqual(before);expect(await s.unit.run(()=>true)).toBe(true);
});
test('freeze retry detects changed data and cannot adopt an unrelated disabled source',async()=>{
 const {freezeDeployment}=await import('./operational-snapshot.ts'),s=await setup(),ticket=randomUUID(),runtime='e'.repeat(64);
 await freezeDeployment(source,s.identity,ticket,runtime);
 await source.query("UPDATE atarasy_member.engine_rows SET value='{}' WHERE deployment=$1 AND namespace='snapshot_probe'",[s.identity.id]);
 await expect(freezeDeployment(source,s.identity,ticket,runtime)).rejects.toThrow();
 const other=await setup();await source.query('UPDATE atarasy_member.control SET enabled=false WHERE id=$1',[other.identity.id]);
 await expect(freezeDeployment(source,other.identity,randomUUID(),runtime)).rejects.toThrow();
});

test('simultaneous different freeze tickets have exactly one durable winner',async()=>{
 const {freezeDeployment}=await import('./operational-snapshot.ts'),s=await setup(),tickets=[randomUUID(),randomUUID()];
 const results=await Promise.allSettled(tickets.map(ticket=>freezeDeployment(source,s.identity,ticket,'9'.repeat(64))));
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 const snapshot=await captureDeployment(source,s.identity);expect(snapshot.sourceEnabled).toBe(false);
 const held=JSON.parse(snapshot.rows.find(r=>r.namespace==='member_writer_migration')!.value);
 expect(results[tickets.indexOf(held.ticket)]!.status).toBe('fulfilled');
});
test('activation retires the old writer and repeats safely after destination writes',async()=>{
 const {freezeDeployment,activateDeploymentCandidate}=await import('./operational-snapshot.ts'),s=await setup(),ticket=randomUUID(),runtime='1'.repeat(64);
 const frozen=await freezeDeployment(source,s.identity,ticket,runtime);await restoreDeploymentCandidate(target,frozen,s.identity);
 const first=await activateDeploymentCandidate(source,target,s.identity,ticket,runtime);expect(first.activated).toBe(true);
 await expect(s.unit.run(()=>null)).rejects.toThrow('fenced');
 const unit=postgresStore(target,s.identity);await unit.run(store=>{store.map('after_migration').set('new',1);});
 expect(await activateDeploymentCandidate(source,target,s.identity,ticket,runtime)).toEqual(first);
 expect(await unit.run(store=>store.map('after_migration').get('new'))).toBe(1);
 await expect(restoreDeploymentCandidate(source,await captureDeployment(target,s.identity),s.identity)).rejects.toThrow();
});
test('activation failure after durable source retirement leaves both disabled and exact retry recovers',async()=>{
 const {freezeDeployment,activateDeploymentCandidate}=await import('./operational-snapshot.ts'),s=await setup(),ticket=randomUUID(),runtime='2'.repeat(64);
 await restoreDeploymentCandidate(target,await freezeDeployment(source,s.identity,ticket,runtime),s.identity);
 const failing={async connect(){const c=await target.connect();return new Proxy(c,{get(client,key){if(key==='query')return async(...args:any[])=>{if(typeof args[0]==='string'&&args[0].startsWith('UPDATE atarasy_member.control SET enabled=true'))throw new Error('injected activation failure');return(client.query as any)(...args);};const value=Reflect.get(client,key);return typeof value==='function'?value.bind(client):value;}});}} as typeof target;
 await expect(activateDeploymentCandidate(source,failing,s.identity,ticket,runtime)).rejects.toThrow('injected activation failure');
 const frozen=await captureDeployment(source,s.identity);expect(frozen.sourceEnabled).toBe(false);expect(JSON.parse(frozen.rows.find(r=>r.namespace==='member_writer_migration')!.value).phase).toBe('retired');
 expect((await captureDeployment(target,s.identity)).sourceEnabled).toBe(false);
 expect((await activateDeploymentCandidate(source,target,s.identity,ticket,runtime)).activated).toBe(true);
});
test('changed destination is never enabled and cannot retire its source',async()=>{
 const {freezeDeployment,activateDeploymentCandidate}=await import('./operational-snapshot.ts'),s=await setup(),ticket=randomUUID(),runtime='3'.repeat(64);
 await restoreDeploymentCandidate(target,await freezeDeployment(source,s.identity,ticket,runtime),s.identity);
 await target.query("UPDATE atarasy_member.engine_rows SET value='{}' WHERE deployment=$1 AND namespace='snapshot_probe'",[s.identity.id]);
 await expect(activateDeploymentCandidate(source,target,s.identity,ticket,runtime)).rejects.toThrow();
 const frozen=await captureDeployment(source,s.identity);expect(JSON.parse(frozen.rows.find(r=>r.namespace==='member_writer_migration')!.value).phase).toBe('frozen');expect((await captureDeployment(target,s.identity)).sourceEnabled).toBe(false);
});
test('a second independently restored destination cannot activate the retired ticket',async()=>{
 const {freezeDeployment,activateDeploymentCandidate}=await import('./operational-snapshot.ts'),s=await setup(),ticket=randomUUID(),runtime='4'.repeat(64),frozen=await freezeDeployment(source,s.identity,ticket,runtime);
 const otherDB='other_'+randomUUID().replaceAll('-',''),otherURL=new URL(url!);otherURL.pathname='/'+otherDB;
 await source.query(`CREATE DATABASE "${otherDB}"`);const other=createPool(otherURL.toString());
 try{await migrateDatabase(otherURL.toString());await restoreDeploymentCandidate(target,frozen,s.identity);await restoreDeploymentCandidate(other,frozen,s.identity);
 const results=await Promise.allSettled([activateDeploymentCandidate(source,target,s.identity,ticket,runtime),activateDeploymentCandidate(source,other,s.identity,ticket,runtime)]);
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 const states=await Promise.all([captureDeployment(target,s.identity),captureDeployment(other,s.identity)]);expect(states.filter(s=>s.sourceEnabled)).toHaveLength(1);
 }finally{await other.end();await source.query(`DROP DATABASE "${otherDB}" WITH (FORCE)`);}
});
test('lost source-retirement and target-activation acknowledgements resume from durable state',async()=>{
 const {freezeDeployment,activateDeploymentCandidate}=await import('./operational-snapshot.ts');
 for(const side of ['source','target']){
  const s=await setup(),ticket=randomUUID(),runtime='5'.repeat(64);await restoreDeploymentCandidate(target,await freezeDeployment(source,s.identity,ticket,runtime),s.identity);
  let commits=0;const underlying=side==='source'?source:target;
  const lost={async connect(){const c=await underlying.connect();return new Proxy(c,{get(client,key){if(key==='query')return async(...args:any[])=>{const result=await(client.query as any)(...args);if(args[0]==='COMMIT'&&++commits===(side==='source'?1:2))throw new Error('lost commit acknowledgement');return result;};const value=Reflect.get(client,key);return typeof value==='function'?value.bind(client):value;}});}} as typeof source;
  await expect(activateDeploymentCandidate(side==='source'?lost:source,side==='target'?lost:target,s.identity,ticket,runtime)).rejects.toThrow('lost commit acknowledgement');
  expect((await captureDeployment(source,s.identity)).sourceEnabled).toBe(false);
  expect((await captureDeployment(target,s.identity)).sourceEnabled).toBe(side==='target');
  expect((await activateDeploymentCandidate(source,target,s.identity,ticket,runtime)).activated).toBe(true);
 }
});
test('abort restores only the source and permanently invalidates copied candidates and ticket reuse',async()=>{
 const {freezeDeployment,activateDeploymentCandidate,abortDeploymentMigration}=await import('./operational-snapshot.ts'),s=await setup(),ticket=randomUUID(),runtime='6'.repeat(64);
 const frozen=await freezeDeployment(source,s.identity,ticket,runtime);await restoreDeploymentCandidate(target,frozen,s.identity);
 await expect(abortDeploymentMigration(target,s.identity,ticket,runtime)).rejects.toThrow();
 expect(await abortDeploymentMigration(source,s.identity,ticket,runtime)).toEqual({aborted:true});
 await s.unit.run(store=>{store.map('after_abort').set('new',1);});
 expect(await abortDeploymentMigration(source,s.identity,ticket,runtime)).toEqual({aborted:true});
 await expect(freezeDeployment(source,s.identity,ticket,runtime)).rejects.toThrow();
 await expect(activateDeploymentCandidate(source,target,s.identity,ticket,runtime)).rejects.toThrow();
 expect((await captureDeployment(target,s.identity)).sourceEnabled).toBe(false);
 const next=await freezeDeployment(source,s.identity,randomUUID(),runtime);expect(next.rows.some(r=>r.namespace==='after_abort')).toBe(true);
});
test('abort racing activation never enables both writers',async()=>{
 const {freezeDeployment,activateDeploymentCandidate,abortDeploymentMigration}=await import('./operational-snapshot.ts'),s=await setup(),ticket=randomUUID(),runtime='7'.repeat(64);
 await restoreDeploymentCandidate(target,await freezeDeployment(source,s.identity,ticket,runtime),s.identity);
 const results=await Promise.allSettled([abortDeploymentMigration(source,s.identity,ticket,runtime),activateDeploymentCandidate(source,target,s.identity,ticket,runtime)]);
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 const states=await Promise.all([captureDeployment(source,s.identity),captureDeployment(target,s.identity)]);expect(states.filter(s=>s.sourceEnabled)).toHaveLength(1);
});
test('a migrated active host can migrate again without losing newer writes or prior migration history',async()=>{
 const {freezeDeployment,activateDeploymentCandidate,abortDeploymentMigration}=await import('./operational-snapshot.ts'),s=await setup(),ticket=randomUUID(),runtime='8'.repeat(64);
 await restoreDeploymentCandidate(target,await freezeDeployment(source,s.identity,ticket,runtime),s.identity);const first=await activateDeploymentCandidate(source,target,s.identity,ticket,runtime);
 await expect(abortDeploymentMigration(source,s.identity,ticket,runtime)).rejects.toThrow();
 await postgresStore(target,s.identity).run(store=>{store.map('after_first_move').set('retained',{counter:9});});
 const nextTicket=randomUUID(),next=await freezeDeployment(target,s.identity,nextTicket,runtime);
 expect(next.rows.some(r=>r.namespace==='member_writer_target')).toBe(false);
 expect(JSON.parse(next.rows.find(r=>r.namespace==='member_writer_history'&&r.key===ticket)!.value).target.instance).toBe(first.instance);
 expect(await freezeDeployment(target,s.identity,nextTicket,runtime)).toEqual(next);
 const thirdDB='third_'+randomUUID().replaceAll('-',''),thirdURL=new URL(url!);thirdURL.pathname='/'+thirdDB;await source.query(`CREATE DATABASE "${thirdDB}"`);const third=createPool(thirdURL.toString());
 try{await migrateDatabase(thirdURL.toString());await restoreDeploymentCandidate(third,next,s.identity);const moved=await activateDeploymentCandidate(target,third,s.identity,nextTicket,runtime);expect(moved.instance).not.toBe(first.instance);
 expect(await postgresStore(third,s.identity).run(store=>store.map('after_first_move').get('retained'))).toEqual({counter:9});
 await expect(postgresStore(target,s.identity).run(()=>null)).rejects.toThrow('fenced');await expect(s.unit.run(()=>null)).rejects.toThrow('fenced');
 await expect(activateDeploymentCandidate(source,target,s.identity,ticket,runtime)).rejects.toThrow();
 }finally{await third.end();await source.query(`DROP DATABASE "${thirdDB}" WITH (FORCE)`);}
});
test('abort rolls back before commit and lost commit acknowledgement is idempotently recoverable',async()=>{
 const {freezeDeployment,abortDeploymentMigration}=await import('./operational-snapshot.ts');
 for(const afterCommit of [false,true]){
  const s=await setup(),ticket=randomUUID(),runtime='a'.repeat(64),frozen=await freezeDeployment(source,s.identity,ticket,runtime);
  const failing={async connect(){const c=await source.connect();return new Proxy(c,{get(client,key){if(key==='query')return async(...args:any[])=>{if(!afterCommit&&typeof args[0]==='string'&&args[0].startsWith('UPDATE atarasy_member.control SET enabled=true'))throw new Error('abort interruption');const result=await(client.query as any)(...args);if(afterCommit&&args[0]==='COMMIT')throw new Error('abort interruption');return result;};const value=Reflect.get(client,key);return typeof value==='function'?value.bind(client):value;}});}} as typeof source;
  await expect(abortDeploymentMigration(failing,s.identity,ticket,runtime)).rejects.toThrow('abort interruption');
  if(!afterCommit)expect(await captureDeployment(source,s.identity)).toEqual(frozen);
  expect(await abortDeploymentMigration(source,s.identity,ticket,runtime)).toEqual({aborted:true});expect(await s.unit.run(()=>true)).toBe(true);
 }
});

async function commandSetup(){
 const s=await setup(),{memberRuntimeIdentity}=await import('./config.ts');
 const config={environment:'test',origin:'https://unit.example',rpID:'unit.example',androidAppOrigins:[],explorationRate:0.2,reminderLimit:1 as const,recoveryGraceDays:3,dayBoundary:'UTC' as const,maximumLifetimeMs:60000,maxSessionLifetimeMs:100000,maximumBodyBytes:20000,bodyTimeoutMs:100,maximumPending:8,budgetWindowMs:60000,maximumRequests:100,maximumTrackedTokens:100};
 await s.unit.run(store=>{store.map('member_config').set('current',memberRuntimeIdentity(config));store.map('private_probe').set('secret',{token:'do-not-print-household-secret'});});
 const {mkdtempSync,mkdirSync,writeFileSync}=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{writeRuntimeManifest}=await import('./runtime-artifact.ts');
 const artifact=mkdtempSync(join(tmpdir(),'migration-artifact-'));artifactDirectories.push(artifact);mkdirSync(join(artifact,'api'));mkdirSync(join(artifact,'public'));
 for(const path of ['api/index.js','vercel.json','package.json','.vercelignore','public/robots.txt'])writeFileSync(join(artifact,path),'synthetic artifact '+path);
 const runtimeFingerprint=writeRuntimeManifest(artifact,s.identity,config);
 return {...s,plan:{identity:s.identity,ticket:randomUUID(),runtimeFingerprint,config},env:{ATARASY_MIGRATION_SOURCE_URL:url!,ATARASY_MIGRATION_TARGET_URL:targetURL.toString(),ATARASY_MIGRATION_ARTIFACT_DIR:artifact}};
}
test('operator commands inspect freeze restore retry activate without returning private rows',async()=>{
 const {runMigrationCommand}=await import('./migration-command.ts'),s=await commandSetup();
 expect(await runMigrationCommand('inspect-source',s.plan,s.env)).toMatchObject({ok:true,enabled:true,phase:'unfrozen'});
 await expect(runMigrationCommand('restore',s.plan,s.env)).rejects.toThrow();expect((await captureDeployment(source,s.identity)).sourceEnabled).toBe(true);
 expect(await runMigrationCommand('freeze',s.plan,s.env)).toMatchObject({ok:true,enabled:false,phase:'frozen'});
 expect(await runMigrationCommand('restore',s.plan,s.env)).toMatchObject({ok:true,restored:true,enabled:false});
 expect(await runMigrationCommand('restore',s.plan,s.env)).toMatchObject({ok:true,restored:true});
 expect(await runMigrationCommand('activate',s.plan,s.env)).toMatchObject({ok:true,activated:true});
 const report=await runMigrationCommand('inspect-target',s.plan,s.env);expect(report).toMatchObject({ok:true,enabled:true,phase:'active'});expect(JSON.stringify(report)).not.toContain('do-not-print');
});
test('operator plan mismatch fails before freezing and abort remains explicit',async()=>{
 const {runMigrationCommand}=await import('./migration-command.ts'),s=await commandSetup();
 const wrong=structuredClone(s.plan);wrong.config.explorationRate=0.4;
 await expect(runMigrationCommand('freeze',wrong,s.env)).rejects.toThrow();expect((await captureDeployment(source,s.identity)).sourceEnabled).toBe(true);
 await runMigrationCommand('freeze',s.plan,s.env);expect(await runMigrationCommand('abort',s.plan,s.env)).toMatchObject({ok:true,aborted:true});expect((await captureDeployment(source,s.identity)).sourceEnabled).toBe(true);
 await expect(runMigrationCommand('freeze',s.plan,{DATABASE_URL:url!})).rejects.toThrow();
});
test('CLI emits only bounded summaries and redacts underlying failures',async()=>{
 const {mkdtempSync,writeFileSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),s=await commandSetup();
 const dir=mkdtempSync(join(tmpdir(),'migration-command-')),plan=join(dir,'plan.json');writeFileSync(plan,JSON.stringify(s.plan));
 const cli=new URL('./migration-command.ts',import.meta.url).pathname;
 try{
  const invoke=async(args:string[],env:Record<string,string>)=>{const child=Bun.spawn([process.execPath,cli,...args],{env:{PATH:process.env.PATH!,...env},stdout:'pipe',stderr:'pipe'});const [out,err,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);return {out,err,code};};
  const good=await invoke(['inspect-source',plan],s.env);expect(good.code).toBe(0);expect(JSON.parse(good.out)).toMatchObject({ok:true,enabled:true});expect(good.err).toBe('');expect(good.out).not.toContain('do-not-print');expect(good.out).not.toContain(url!);
  const bad=await invoke(['inspect-source',plan],{ATARASY_MIGRATION_SOURCE_URL:'postgres://do-not-print-password@127.0.0.1:1/missing'});expect(bad.code).toBe(1);expect(bad.out).toBe('');expect(JSON.parse(bad.err).error).toBe('migration_failed');expect(bad.err).not.toContain('do-not-print-password');expect(bad.err).not.toContain('127.0.0.1');
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('a changed local runtime artifact refuses migration before freezing the source',async()=>{
 const {runMigrationCommand}=await import('./migration-command.ts'),{appendFileSync}=await import('node:fs'),s=await commandSetup();
 appendFileSync(s.env.ATARASY_MIGRATION_ARTIFACT_DIR+'/api/index.js','changed');
 await expect(runMigrationCommand('freeze',s.plan,s.env)).rejects.toThrow();expect((await captureDeployment(source,s.identity)).sourceEnabled).toBe(true);
});
