import {beforeAll,afterAll,expect,test} from 'bun:test';
import {randomUUID} from 'node:crypto';
import {createPool,initialiseDeployment,postgresStore,type Identity} from './store.ts';
import {migrateDatabase} from './migrate.ts';
import {captureDeployment,restoreDeploymentCandidate} from './operational-snapshot.ts';
const url=process.env.ATARASY_TEST_POSTGRES_URL;if(!url)throw new Error('Explicit isolated ATARASY_TEST_POSTGRES_URL required');
const source=createPool(url),db='snapshot_'+randomUUID().replaceAll('-',''),targetURL=new URL(url);targetURL.pathname='/'+db;
const target=createPool(targetURL.toString()),ids:string[]=[];
beforeAll(async()=>{await migrateDatabase(url);await source.query(`CREATE DATABASE "${db}"`);await migrateDatabase(targetURL.toString());});
afterAll(async()=>{await target.end();await source.query(`DROP DATABASE "${db}" WITH (FORCE)`);for(const id of ids){await source.query('DELETE FROM atarasy_member.engine_rows WHERE deployment=$1',[id]);await source.query('DELETE FROM atarasy_member.control WHERE id=$1',[id]);}await source.end();});
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
