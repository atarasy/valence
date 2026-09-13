import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { realpathSync, existsSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { createOperationalSnapshot, inspectOperationalDatabase } from './operational-snapshot.ts';
import { decodeFence, type Fence } from './writer-fence.ts';
type Scope = { environment: string; origin: string; rpID: string };
const baseFor = (p: Scope) => JSON.stringify(['atarasy.local-engine-unit.1',p.environment,p.origin]);
function meta(db: Database): string { const r=db.query('SELECT scope FROM atomic_meta').all() as {scope:string}[];if(r.length!==1)throw new Error('Invalid cutover metadata');return r[0]!.scope; }
async function locked<T>(path:string, work:(db:Database)=>T):Promise<T> {
 const db=new Database(path,{readwrite:true});db.run('PRAGMA busy_timeout=0');db.run('PRAGMA synchronous=FULL');let begun=false;
 try {const deadline=performance.now()+5000;while(true){try{db.run('BEGIN IMMEDIATE');begun=true;break;}catch(e){if((e as {code?:string}).code!=='SQLITE_BUSY'||performance.now()>=deadline)throw e;await Bun.sleep(5);}}const result=work(db);db.run('COMMIT');begun=false;return result;}
 finally {if(begun)db.run('ROLLBACK');db.close();}
}
function readFence(path:string,p:Scope) {const db=new Database(path,{readonly:true});try{return decodeFence(meta(db),baseFor(p));}finally{db.close();}}
function same(a:Fence,b:Fence) {return a.ticket===b.ticket&&a.base===b.base&&a.source===b.source&&a.target===b.target&&a.runtime===b.runtime&&a.digest===b.digest;}
function activatedFor(db:Database,f:Fence) {const row=db.query("SELECT v FROM atomic_rows WHERE namespace='writer_activation' AND k='current'").get() as {v:string}|null;if(!row||!same(decodeFence(row.v,f.base),f))throw new Error('Activation receipt mismatch');}
/** Stops updated writers and creates a still-fenced candidate. No network/server activation. */
export async function prepareLocalCutover(sourcePath:string,newDirectory:string,scope:Scope,runtimeFingerprint:string) {
 if(!/^[a-f0-9]{64}$/.test(runtimeFingerprint))throw new Error('Invalid runtime fingerprint');
 const p=structuredClone(scope),source=realpathSync(sourcePath),directory=join(realpathSync(dirname(newDirectory)),basename(newDirectory)),target=join(directory,'candidate.sqlite');
 if(existsSync(directory))throw new Error('Cutover destination exists');
 const fence=await locked(source,db=>{if(meta(db)!==baseFor(p))throw new Error('Source is not active');const digest=inspectOperationalDatabase(db,p);const f:Fence={profile:'atarasy.local-writer-fence.1',base:baseFor(p),ticket:randomUUID(),source,target,runtime:runtimeFingerprint,digest,phase:'frozen'};db.query('UPDATE atomic_meta SET scope=?').run(JSON.stringify(f));return f;});
 // Any copy failure deliberately leaves the source fenced for explicit recovery.
 const candidate=createOperationalSnapshot(source,directory,p);
 if(candidate.digest!==fence.digest)throw new Error('Cutover snapshot changed');
 return {ticket:fence.ticket,source,target,digest:fence.digest,runtime:fence.runtime,activated:false as const};
}
/** Recover a frozen ticket when copying had not started, or verify its completed copy. */
export function resumeLocalCutoverPreparation(sourcePath:string,scope:Scope,ticket:string,runtimeFingerprint:string) {
 const p=structuredClone(scope),source=realpathSync(sourcePath),f=readFence(source,p);
 if(f.source!==source||f.phase!=='frozen'||f.ticket!==ticket||f.runtime!==runtimeFingerprint)throw new Error('Cutover identity mismatch');
 const origin=new Database(source,{readonly:true});try{if(inspectOperationalDatabase(origin,p)!==f.digest)throw new Error('Cutover source changed');}finally{origin.close();}
 if(!existsSync(dirname(f.target)))createOperationalSnapshot(source,dirname(f.target),p);
 const target=new Database(f.target,{readonly:true});try{if(realpathSync(f.target)!==f.target||!same(decodeFence(meta(target),f.base),f)||inspectOperationalDatabase(target,p)!==f.digest)throw new Error('Cutover copy incomplete');}finally{target.close();}
 return {ticket:f.ticket,source,target:f.target,digest:f.digest,runtime:f.runtime,activated:false as const};
}
/** Retire-before-enable order is safe across interruption; repeat only for this exact transition. */
export async function activateLocalCutover(sourcePath:string,scope:Scope,ticket:string,runtimeFingerprint:string) {
 const p=structuredClone(scope),source=realpathSync(sourcePath),initial=readFence(source,p);
 if(initial.source!==source||initial.ticket!==ticket||initial.runtime!==runtimeFingerprint||realpathSync(initial.target)!==initial.target)throw new Error('Cutover identity mismatch');
 const state=await locked(source,db=>{
  const f=decodeFence(meta(db),baseFor(p));if(!same(f,initial)||inspectOperationalDatabase(db,p)!==f.digest)throw new Error('Cutover source changed');
  // Preflight the blocked target; revalidate under its write lock before activation.
  const target=new Database(f.target,{readonly:true});try {const raw=meta(target);if(raw===f.base){if(f.phase!=='retired')throw new Error('Target active before retirement');activatedFor(target,f);return {f,already:true};}const t=decodeFence(raw,f.base);if(!same(f,t)||t.phase!=='frozen'||inspectOperationalDatabase(target,p)!==f.digest)throw new Error('Cutover target changed');}finally{target.close();}
  if(f.phase==='frozen'){f.phase='retired';db.query('UPDATE atomic_meta SET scope=?').run(JSON.stringify(f));}
  return {f,already:false};
 });
 if(state.already)return {ticket,target:initial.target,activated:true as const};
 await locked(initial.target,db=>{const raw=meta(db);if(raw===initial.base){activatedFor(db,initial);return;}const t=decodeFence(raw,initial.base);if(!same(t,initial)||t.phase!=='frozen'||inspectOperationalDatabase(db,p)!==initial.digest)throw new Error('Cutover target changed');db.query("INSERT OR REPLACE INTO atomic_rows VALUES ('writer_activation','current',?)").run(JSON.stringify({...initial,phase:'retired'}));db.query('UPDATE atomic_meta SET scope=?').run(initial.base);});
 return {ticket,target:initial.target,activated:true as const};
}
