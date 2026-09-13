import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { createOperationalSnapshot } from './operational-snapshot.ts';
import { seedUnified, unifiedRuntime, loginResponse } from './unified-fixture.ts';
import { openAtomicStore } from './atomic-store.ts';
import { openStatementAuthorisations } from './statement-authorisation.ts';
import { atomicScope, fixtureTime } from './atomic-fixture.ts';
const cleanup: (() => void)[] = [];
afterEach(() => { for (const f of cleanup.splice(0).reverse()) f(); });
const scope = { environment: 'test', origin: atomicScope.audience, rpID: 'unit.example' };
const policy = { ...scope, maximumLifetimeMs: 5000, maxSessionLifetimeMs: 10000, now: () => fixtureTime + 1, engine: { explorationRate: 0.2, reminderLimit: 1 as const, recoveryGraceDays: 3, relyingPartyId: scope.rpID } };
async function setup() {
  const dir = mkdtempSync(join(tmpdir(),'operational-snapshot-')); cleanup.push(()=>rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,'source.sqlite'), seeded=await seedUnified(path), api=openStatementAuthorisations(path,policy);cleanup.push(()=>api.close());
  await api.cancel(seeded.input.token,seeded.input.operation.id); const prepared=await api.prepare(seeded.input.token,{offer:seeded.input.statement.offer,disputed:[]});
  const proof=loginResponse(seeded.pair,seeded.input.credential,seeded.user,prepared.publicKey.challenge,2);
  return {dir,path,...seeded,api,prepared,proof};
}
function logical(path:string) { const db=new Database(path,{readonly:true});try { const tables=db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as {name:string}[];return createHash('sha256').update(JSON.stringify(tables.map(t=>[t.name,db.query(`SELECT * FROM "${t.name}" ORDER BY rowid`).all()]))).digest('hex'); }finally{db.close();} }
function target(path:string) { const api=openStatementAuthorisations(path,policy);cleanup.push(()=>api.close());return api; }
test('complete candidate preserves BLOB keys sessions and prepared approval then settles on the destination',async()=>{
 const s=await setup(), before=logical(s.path), result=createOperationalSnapshot(s.path,join(s.dir,'candidate'),scope);
 expect(result).toMatchObject({verified:true,cutover:false});expect(logical(s.path)).toBe(before);expect(logical(result.destination)).toBe(before);
 expect(statSync(result.destination).mode&0o777).toBe(0o600);expect(statSync(join(s.dir,'candidate')).mode&0o777).toBe(0o700);
 const api=target(result.destination);expect((await api.read(s.input.token,s.prepared.operationID)).authorisation).toBe('prepared');
 expect((await api.settle(s.input.token,s.prepared.operationID,s.proof)).receipt.charged).toBe(1200);
 expect((await s.api.read(s.input.token,s.prepared.operationID)).operationState).toBe('prepared');
});
test('committed contextual outcome retains exact replay identity and does not charge again after migration',async()=>{
 const s=await setup(), receipt=await s.api.settle(s.input.token,s.prepared.operationID,s.proof), result=createOperationalSnapshot(s.path,join(s.dir,'committed'),scope);
 expect(await target(result.destination).settle(s.input.token,s.prepared.operationID,s.proof)).toEqual(receipt);
 const unit=openAtomicStore(result.destination,atomicScope);try{expect(await unit.run((store,db)=>unifiedRuntime(store,db).engine.householdLedger.forHousehold('house'))).toHaveLength(1);}finally{unit.close();}
});
test('verified proof and pending login challenge share the preserved counter after migration',async()=>{
 const s=await setup();await s.api.verify(s.input.token,s.prepared.operationID,s.proof);
 const unit=openAtomicStore(s.path,atomicScope);const flow=await unit.run((store,db)=>unifiedRuntime(store,db).login.begin());unit.close();
 const result=createOperationalSnapshot(s.path,join(s.dir,'verified'),scope), copied=openAtomicStore(result.destination,atomicScope);
 try {
  const response=loginResponse(s.pair,s.input.credential,s.user,flow.publicKey.challenge,3);
  expect((await copied.run((store,db)=>unifiedRuntime(store,db).login.finish(flow.id,response))).token.length).toBeGreaterThan(0);
  await expect(copied.run((store,db)=>unifiedRuntime(store,db).login.finish(flow.id,response))).rejects.toThrow();
 }finally{copied.close();}
 expect((await target(result.destination).settle(s.input.token,s.prepared.operationID,s.proof)).receipt.charged).toBe(1200);
});
test('revoked credentials remain revoked and uncertain operations are never reset',async()=>{
 const s=await setup(), unit=openAtomicStore(s.path,atomicScope);
 await unit.run(async(store,db)=>{const r=unifiedRuntime(store,db);await r.journal.claimVerified(s.input.token,s.prepared.operationID,{requestDigest:s.prepared.requestDigest,reviewedRevision:s.prepared.reviewedRevision,assertionFingerprint:'a'.repeat(64)});r.journal.markUncertain(s.prepared.operationID);});
 const pending=createOperationalSnapshot(s.path,join(s.dir,'uncertain'),scope), api=target(pending.destination);
 expect((await api.read(s.input.token,s.prepared.operationID)).operationState).toBe('uncertain');await expect(api.settle(s.input.token,s.prepared.operationID,s.proof)).rejects.toThrow();
 await unit.run((store,db)=>unifiedRuntime(store,db).authority.revokeCredential(s.input.credential));unit.close();
 const revoked=createOperationalSnapshot(s.path,join(s.dir,'revoked'),scope);await expect(target(revoked.destination).read(s.input.token,s.prepared.operationID)).rejects.toThrow();
});
test('scope unknown schema namespace and damaged operation refuse before destination creation',async()=>{
 for(const mode of ['scope','trigger','namespace','operation']){
  const s=await setup(), destination=join(s.dir,'refused');
  if(mode!=='scope'){const db=new Database(s.path);if(mode==='trigger')db.run('CREATE TRIGGER extra_trigger AFTER INSERT ON challenges BEGIN SELECT 1; END');if(mode==='namespace')db.query('INSERT INTO atomic_rows VALUES (?,?,?)').run('unknown_namespace','x','{}');if(mode==='operation'){const row=db.query('SELECT record FROM operations WHERE id=?').get(s.prepared.operationID) as {record:string};const value=JSON.parse(row.record);value.requestDigest='0'.repeat(64);db.query('UPDATE operations SET record=? WHERE id=?').run(JSON.stringify(value),s.prepared.operationID);}db.close();}
  expect(()=>createOperationalSnapshot(s.path,destination,mode==='scope'?{...scope,environment:'other'}:scope)).toThrow();expect(existsSync(destination)).toBe(false);
 }
});
test('destination overwrite is refused and new source writes require another snapshot',async()=>{
 const s=await setup(), destination=join(s.dir,'existing'), first=createOperationalSnapshot(s.path,destination,scope), before=logical(first.destination);
 expect(()=>createOperationalSnapshot(s.path,destination,scope)).toThrow();expect(logical(first.destination)).toBe(before);
 await s.api.verify(s.input.token,s.prepared.operationID,s.proof);const next=createOperationalSnapshot(s.path,join(s.dir,'newer'),scope);
 expect(next.digest).not.toBe(first.digest);expect(logical(first.destination)).toBe(before);
});
