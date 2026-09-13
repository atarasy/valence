import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { seedUnified, loginResponse } from './unified-fixture.ts';
import { fixtureTime, atomicScope } from './atomic-fixture.ts';
import { openAtomicStore } from './atomic-store.ts';
import { openStatementAuthorisations } from './statement-authorisation.ts';
import { prepareLocalCutover, activateLocalCutover, resumeLocalCutoverPreparation } from './local-cutover.ts';
const cleanup:(()=>void)[]=[];afterEach(()=>{for(const f of cleanup.splice(0).reverse())f();});
const scope={environment:'test',origin:atomicScope.audience,rpID:'unit.example'},runtime='a'.repeat(64);
const policy={...scope,maximumLifetimeMs:5000,maxSessionLifetimeMs:10000,now:()=>fixtureTime+1,engine:{explorationRate:0.2,reminderLimit:1 as const,recoveryGraceDays:3,relyingPartyId:scope.rpID}};
async function setup(){const dir=mkdtempSync(join(tmpdir(),'local-cutover-'));cleanup.push(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'source.sqlite'),seeded=await seedUnified(path),api=openStatementAuthorisations(path,policy);cleanup.push(()=>api.close());await api.cancel(seeded.input.token,seeded.input.operation.id);const prepared=await api.prepare(seeded.input.token,{offer:seeded.input.statement.offer,disputed:[]});const proof=loginResponse(seeded.pair,seeded.input.credential,seeded.user,prepared.publicKey.challenge,2);return {dir,path,...seeded,api,prepared,proof};}
const metadata=(path:string)=>{const db=new Database(path,{readonly:true});try{return (db.query('SELECT scope FROM atomic_meta').get() as {scope:string}).scope;}finally{db.close();}};
test('freeze blocks existing and reopened writers; activation enables only the exact destination',async()=>{
 const s=await setup(),plan=await prepareLocalCutover(s.path,join(s.dir,'target'),scope,runtime);
 await expect(s.api.verify(s.input.token,s.prepared.operationID,s.proof)).rejects.toThrow('fenced');
 expect(()=>openAtomicStore(s.path,atomicScope)).toThrow('scope');expect(()=>openAtomicStore(plan.target,atomicScope)).toThrow('scope');
 const result=await activateLocalCutover(s.path,scope,plan.ticket,runtime);expect(result.activated).toBe(true);expect(JSON.parse(metadata(s.path)).phase).toBe('retired');
 const target=openStatementAuthorisations(plan.target,policy);cleanup.push(()=>target.close());expect((await target.settle(s.input.token,s.prepared.operationID,s.proof)).receipt.charged).toBe(1200);
 expect(await activateLocalCutover(s.path,scope,plan.ticket,runtime)).toEqual(result);await expect(s.api.read(s.input.token,s.prepared.operationID)).rejects.toThrow('fenced');
});
test('freeze waits for admitted local work and includes its last committed write',async()=>{
 const s=await setup(),unit=openAtomicStore(s.path,atomicScope);cleanup.push(()=>unit.close());let release!:()=>void;const barrier=new Promise<void>(r=>{release=r;});
 const owner=unit.run(async store=>{const m=store.map('bare_receipts');m.set('house',[{ref:'last-write',at:fixtureTime}]);await barrier;});
 const freezing=prepareLocalCutover(s.path,join(s.dir,'target'),scope,runtime);await Bun.sleep(15);expect(metadata(s.path)).toBe(JSON.stringify(['atarasy.local-engine-unit.1',scope.environment,scope.origin]));release();await owner;const plan=await freezing;
 await expect(unit.run(()=>true)).rejects.toThrow('fenced');await activateLocalCutover(s.path,scope,plan.ticket,runtime);
 const target=openAtomicStore(plan.target,atomicScope);try{expect(await target.run(store=>store.map('bare_receipts').get('house'))).toEqual([{ref:'last-write',at:fixtureTime}]);}finally{target.close();}
});
test('wrong ticket runtime or changed candidate refuse activation while source stays stopped',async()=>{
 const s=await setup(),plan=await prepareLocalCutover(s.path,join(s.dir,'target'),scope,runtime);
 await expect(activateLocalCutover(s.path,scope,'wrong',runtime)).rejects.toThrow();await expect(activateLocalCutover(s.path,scope,plan.ticket,'b'.repeat(64))).rejects.toThrow();
 const db=new Database(plan.target);db.query("UPDATE passkeys SET counter=counter+1").run();db.close();
 await expect(activateLocalCutover(s.path,scope,plan.ticket,runtime)).rejects.toThrow('target changed');expect(JSON.parse(metadata(s.path)).phase).toBe('frozen');expect(()=>openAtomicStore(plan.target,atomicScope)).toThrow();
});
test('failure after source retirement leaves both blocked and exact retry completes activation',async()=>{
 const s=await setup(),plan=await prepareLocalCutover(s.path,join(s.dir,'target'),scope,runtime),held=new Database(plan.target);held.run('PRAGMA journal_mode=WAL');held.run('BEGIN IMMEDIATE');
 const activation=activateLocalCutover(s.path,scope,plan.ticket,runtime);const deadline=performance.now()+1000;
 while(JSON.parse(metadata(s.path)).phase!=='retired'){if(performance.now()>deadline)throw new Error('Retirement not observed');await Bun.sleep(5);}
 // Fault injection while activation waits for the target lock, after successful preflight.
 held.run('UPDATE passkeys SET counter=counter+1');held.run('COMMIT');held.close();
 await expect(activation).rejects.toThrow('target changed');expect(()=>openAtomicStore(s.path,atomicScope)).toThrow();expect(()=>openAtomicStore(plan.target,atomicScope)).toThrow();
 const repair=new Database(plan.target);repair.run('UPDATE passkeys SET counter=counter-1');repair.close();
 expect((await activateLocalCutover(s.path,scope,plan.ticket,runtime)).activated).toBe(true);expect(JSON.parse(metadata(s.path)).phase).toBe('retired');
});
test('concurrent activation is idempotent and requires the durable target activation receipt',async()=>{
 const s=await setup(),plan=await prepareLocalCutover(s.path,join(s.dir,'target'),scope,runtime);
 const results=await Promise.all([activateLocalCutover(s.path,scope,plan.ticket,runtime),activateLocalCutover(s.path,scope,plan.ticket,runtime)]);expect(results[0]).toEqual(results[1]);
 const db=new Database(plan.target);db.run("DELETE FROM atomic_rows WHERE namespace='writer_activation'");db.close();
 await expect(activateLocalCutover(s.path,scope,plan.ticket,runtime)).rejects.toThrow('receipt mismatch');
});
test('existing destination refusal leaves source active',async()=>{
 const s=await setup();await expect(prepareLocalCutover(s.path,s.dir,scope,runtime)).rejects.toThrow('exists');expect((await s.api.read(s.input.token,s.prepared.operationID)).operationState).toBe('prepared');
});

test('frozen preparation resumes a missing copy and verifies an existing copy without overwriting it',async()=>{
 const s=await setup(),directory=join(s.dir,'target'),plan=await prepareLocalCutover(s.path,directory,scope,runtime);
 // Simulate the persisted state of interruption before the copy was created.
 rmSync(directory,{recursive:true,force:true});
 expect(resumeLocalCutoverPreparation(s.path,scope,plan.ticket,runtime)).toEqual(plan);
 expect(resumeLocalCutoverPreparation(s.path,scope,plan.ticket,runtime)).toEqual(plan);
 expect((await activateLocalCutover(s.path,scope,plan.ticket,runtime)).activated).toBe(true);
});
