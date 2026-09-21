import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { StoreError, type Identity } from './store.ts';

type Row = { namespace: string; key: string; value: string };
export type DeploymentSnapshot = { format: 'atarasy.postgres-snapshot.1'; identity: Identity; sourceEnabled: boolean; schema: string; rows: Row[]; digest: string };
const fail = (): never => { throw new StoreError('Invalid PostgreSQL snapshot'); };
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const name = (value: unknown): value is string => typeof value === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(value);
function validIdentity(p: Identity) {
 if (!p || Object.keys(p).sort().join(',') !== 'environment,epoch,id,origin' || !name(p.id) || !name(p.environment) || !Number.isSafeInteger(p.epoch) || p.epoch < 1 || p.epoch > 2147483647 || typeof p.origin !== 'string') fail();
 const url = new URL(p.origin); if (url.origin !== p.origin || url.protocol !== 'https:') fail();
}
function validate(input: DeploymentSnapshot, expected: Identity): DeploymentSnapshot {
 validIdentity(expected);
 const s = structuredClone(input);
 if (!s || Object.keys(s).sort().join(',') !== 'digest,format,identity,rows,schema,sourceEnabled' || s.format !== 'atarasy.postgres-snapshot.1' || typeof s.sourceEnabled !== 'boolean' || !/^[a-f0-9]{64}$/.test(s.schema)) fail();
 validIdentity(s.identity);
 if (s.identity.id !== expected.id || s.identity.environment !== expected.environment || s.identity.origin !== expected.origin || s.identity.epoch !== expected.epoch || !Array.isArray(s.rows) || s.rows.length > 10000) fail();
 let size = 0; const seen = new Set<string>();
 for (const row of s.rows) {
  if (!row || Object.keys(row).sort().join(',') !== 'key,namespace,value' || !name(row.namespace) || typeof row.key !== 'string' || typeof row.value !== 'string') fail();
  const key = JSON.stringify([row.namespace, row.key]); if (seen.has(key)) fail(); seen.add(key);
  const bytes = Buffer.byteLength(row.value); size += bytes; if (bytes > 1048576 || size > 16777216) fail();
  JSON.parse(row.value);
 }
 const { digest, ...content } = s; if (digest !== sha(content)) fail(); return s;
}
/** Compare database structure, not deployment contents or sequence position. */
async function schemaDigest(c: PoolClient): Promise<string> {
 const tables = await c.query("SELECT table_name FROM information_schema.tables WHERE table_schema='atarasy_member' ORDER BY table_name");
 if (JSON.stringify(tables.rows.map(r => r.table_name)) !== '["control","engine_rows"]') fail();
 const triggers = await c.query("SELECT 1 FROM pg_trigger t JOIN pg_class r ON r.oid=t.tgrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='atarasy_member' AND NOT t.tgisinternal");
 if (triggers.rowCount) fail();
 const columns = await c.query("SELECT table_name,column_name,data_type,is_nullable,column_default,is_identity,identity_generation FROM information_schema.columns WHERE table_schema='atarasy_member' ORDER BY table_name,ordinal_position");
 const constraints = await c.query("SELECT r.relname,c.conname,pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='atarasy_member' ORDER BY r.relname,c.conname");
 const indexes = await c.query("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='atarasy_member' ORDER BY tablename,indexname");
 return sha([columns.rows,constraints.rows,indexes.rows]);
}
// Caller owns a database transaction; this also acquires the application writer lock.
async function captureLocked(c: PoolClient, p: Identity): Promise<DeploymentSnapshot> {
  const { rows } = await c.query('SELECT environment,origin,epoch,enabled FROM atarasy_member.control WHERE id=$1 FOR UPDATE',[p.id]);
  const control = rows[0]; if (!control || control.environment !== p.environment || control.origin !== p.origin || control.epoch !== p.epoch) fail();
  const bounds = await c.query('SELECT count(*)::int AS n,coalesce(sum(octet_length(value)),0)::text AS bytes FROM atarasy_member.engine_rows WHERE deployment=$1',[p.id]);
  if (bounds.rows[0].n > 10000 || Number(bounds.rows[0].bytes) > 16777216) fail();
  const schema = await schemaDigest(c);
  const result = await c.query<Row>('SELECT namespace,key,value FROM atarasy_member.engine_rows WHERE deployment=$1 ORDER BY ordinal',[p.id]);
  const content = { format: 'atarasy.postgres-snapshot.1' as const, identity:p, sourceEnabled:control.enabled as boolean, schema, rows:result.rows };
  return validate({...content,digest:sha(content)},p);
}
/** Trusted administrative read. Holds the same deployment lock as every application writer. */
export async function captureDeployment(pool: Pool, input: Identity): Promise<DeploymentSnapshot> {
 const p = structuredClone(input); validIdentity(p); const c = await pool.connect(); let broken = false;
 try {
  await c.query('BEGIN');
  const snapshot = await captureLocked(c,p);
  await c.query('COMMIT'); return snapshot;
 } catch (error) { await c.query('ROLLBACK').catch(()=>{broken=true;}); throw error; } finally { c.release(broken); }
}
/** Restore into an absent deployment only. The result cannot serve requests until a separate cutover. */
export async function restoreDeploymentCandidate(pool: Pool, input: DeploymentSnapshot, expected: Identity): Promise<{ verified: true; enabled: false; digest: string }> {
 const s = validate(input,expected);
 // A destination identity must be minted locally, never cloned from an activated host.
 if (s.rows.some(r => r.namespace === 'member_writer_target')) fail();
 const c = await pool.connect(); let broken = false;
 try {
  await c.query('BEGIN');
  if (await schemaDigest(c) !== s.schema) fail();
  // Primary-key insertion fences concurrent restorers and refuses every existing deployment.
  await c.query('INSERT INTO atarasy_member.control (id,environment,origin,epoch,enabled) VALUES ($1,$2,$3,$4,false)',[s.identity.id,s.identity.environment,s.identity.origin,s.identity.epoch]);
  for (const row of s.rows) await c.query('INSERT INTO atarasy_member.engine_rows (deployment,namespace,key,value) VALUES ($1,$2,$3,$4)',[s.identity.id,row.namespace,row.key,row.value]);
  const actual = await c.query<Row>('SELECT namespace,key,value FROM atarasy_member.engine_rows WHERE deployment=$1 ORDER BY ordinal',[s.identity.id]);
  if (JSON.stringify(actual.rows) !== JSON.stringify(s.rows)) fail();
  // A copied frozen source must never be mistaken for the source by abort.
  const frozenRows = s.rows.filter(r => r.namespace === freezeNamespace);
  if (frozenRows.length) {
   const raw = JSON.parse(frozenRows[0]!.value), f = migration(s,raw.ticket,raw.runtime);
   if (s.sourceEnabled || f.phase !== 'frozen') fail();
   const candidate: TargetWriter = {instance:randomUUID(),ticket:f.ticket,runtime:f.runtime,content:f.content,schema:f.schema,phase:'ready'};
   await c.query('INSERT INTO atarasy_member.engine_rows (deployment,namespace,key,value) VALUES ($1,$2,$3,$4)',[s.identity.id,targetNamespace,'current',JSON.stringify(candidate)]);
   await captureLocked(c,s.identity);
  }
  await c.query('COMMIT'); return {verified:true,enabled:false,digest:s.digest};
 } catch(error) { await c.query('ROLLBACK').catch(()=>{broken=true;}); throw error; } finally { c.release(broken); }
}

const freezeNamespace = 'member_writer_migration';
type FrozenWriter = { profile: 'atarasy.postgres-writer-freeze.2'; ticket: string; runtime: string; phase: 'frozen'; content: string; schema: string };
/** Stop the source and capture its final state atomically. A retry must name the same ticket and runtime. */
export async function freezeDeployment(pool: Pool, input: Identity, ticket: string, runtime: string): Promise<DeploymentSnapshot> {
 const p = structuredClone(input); validIdentity(p);
 if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(ticket) || !/^[a-f0-9]{64}$/.test(runtime)) fail();
 const c = await pool.connect(); let broken = false;
 try {
  await c.query('BEGIN');
  let before = await captureLocked(c,p);
  if (before.rows.some(r => r.namespace === historyNamespace && r.key === ticket)) fail();
  const arrived = targetRecord(before);
  if (arrived) {
   if (!before.sourceEnabled || arrived.phase !== 'active' || arrived.ticket === ticket) fail();
   const old = migration(before,arrived.ticket,arrived.runtime,false);
   if (old.phase !== 'frozen' || arrived.content !== old.content || arrived.schema !== old.schema) fail();
   await c.query('INSERT INTO atarasy_member.engine_rows (deployment,namespace,key,value) VALUES ($1,$2,$3,$4)',[p.id,historyNamespace,arrived.ticket,JSON.stringify({outcome:'arrived',migration:old,target:arrived})]);
   await c.query('DELETE FROM atarasy_member.engine_rows WHERE deployment=$1 AND namespace IN ($2,$3)',[p.id,freezeNamespace,targetNamespace]);
   before = await captureLocked(c,p);
  }
  const records = before.rows.filter(r => r.namespace === freezeNamespace);
  if (records.length) {
   if (records.length !== 1 || records[0]!.key !== 'current' || before.sourceEnabled) fail();
   const held = JSON.parse(records[0]!.value) as FrozenWriter;
   if (!held || Object.keys(held).sort().join(',') !== 'content,phase,profile,runtime,schema,ticket' || held.profile !== 'atarasy.postgres-writer-freeze.2' || held.phase !== 'frozen' || held.ticket !== ticket || held.runtime !== runtime || held.schema !== before.schema || held.content !== sha(before.rows.filter(r => r.namespace !== freezeNamespace))) fail();
   await c.query('COMMIT'); return before;
  }
  // An unrelated administrative disable is not a migration ticket.
  if (!before.sourceEnabled) fail();
  const frozen: FrozenWriter = { profile: 'atarasy.postgres-writer-freeze.2', ticket, runtime, phase: 'frozen', content: sha(before.rows), schema: before.schema };
  await c.query('INSERT INTO atarasy_member.engine_rows (deployment,namespace,key,value) VALUES ($1,$2,$3,$4)',[p.id,freezeNamespace,'current',JSON.stringify(frozen)]);
  await c.query('UPDATE atarasy_member.control SET enabled=false WHERE id=$1',[p.id]);
  const final = await captureLocked(c,p);
  await c.query('COMMIT'); return final;
 } catch(error) { await c.query('ROLLBACK').catch(()=>{broken=true;}); throw error; } finally { c.release(broken); }
}

const targetNamespace = 'member_writer_target';
type TargetWriter = { instance: string; ticket: string; runtime: string; content: string; schema: string; phase: 'ready' | 'active' };
function migration(snapshot: DeploymentSnapshot, ticket: string, runtime: string, checkContent = true): Omit<FrozenWriter,'phase'> & { phase: 'frozen' | 'retired'; target?: string } {
 const rows = snapshot.rows.filter(r => r.namespace === freezeNamespace);
 if (rows.length !== 1 || rows[0]!.key !== 'current') fail();
 const f = JSON.parse(rows[0]!.value);
 const keys = f?.phase === 'retired' ? 'content,phase,profile,runtime,schema,target,ticket' : 'content,phase,profile,runtime,schema,ticket';
 if (!f || Object.keys(f).sort().join(',') !== keys || f.profile !== 'atarasy.postgres-writer-freeze.2' || !['frozen','retired'].includes(f.phase) || f.ticket !== ticket || f.runtime !== runtime || f.schema !== snapshot.schema || !/^[a-f0-9]{64}$/.test(f.content) || (f.phase === 'retired' && !uuid(f.target))) fail();
 if (checkContent && f.content !== sha(snapshot.rows.filter(r => ![freezeNamespace,targetNamespace].includes(r.namespace)))) fail();
 return f;
}
function uuid(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value); }
function targetRecord(snapshot: DeploymentSnapshot): TargetWriter | null {
 const rows = snapshot.rows.filter(r => r.namespace === targetNamespace); if (!rows.length) return null;
 if (rows.length !== 1 || rows[0]!.key !== 'current') fail();
 const t = JSON.parse(rows[0]!.value);
 if (!t || Object.keys(t).sort().join(',') !== 'content,instance,phase,runtime,schema,ticket' || !uuid(t.instance) || !uuid(t.ticket) || !['ready','active'].includes(t.phase) || ![t.content,t.runtime,t.schema].every(v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v))) fail();
 return t;
}
/** Mint one local candidate identity before retiring the source; response loss is recoverable. */
async function registerDeploymentCandidate(pool: Pool, input: Identity, ticket: string, runtime: string): Promise<string> {
 const p = structuredClone(input); validIdentity(p); if (!uuid(ticket) || !/^[a-f0-9]{64}$/.test(runtime)) fail();
 const c = await pool.connect(); let broken = false;
 try {
  await c.query('BEGIN'); const snapshot = await captureLocked(c,p), held = targetRecord(snapshot), f = migration(snapshot,ticket,runtime,!snapshot.sourceEnabled);
  if (f.phase !== 'frozen') fail();
  if (held) {
   if (held.ticket !== ticket || held.runtime !== runtime || held.content !== f.content || held.schema !== f.schema || (snapshot.sourceEnabled ? held.phase !== 'active' : held.phase !== 'ready')) fail();
   await c.query('COMMIT'); return held.instance;
  }
  if (snapshot.sourceEnabled) fail();
  const record: TargetWriter = {instance:randomUUID(),ticket,runtime,content:f.content,schema:f.schema,phase:'ready'};
  await c.query('INSERT INTO atarasy_member.engine_rows (deployment,namespace,key,value) VALUES ($1,$2,$3,$4)',[p.id,targetNamespace,'current',JSON.stringify(record)]);
  await captureLocked(c,p);
  await c.query('COMMIT'); return record.instance;
 } catch(error) { await c.query('ROLLBACK').catch(()=>{broken=true;}); throw error; } finally { c.release(broken); }
}
/** Durable source retirement precedes target enablement. Never enables the old source. */
export async function activateDeploymentCandidate(source: Pool, target: Pool, input: Identity, ticket: string, runtime: string): Promise<{instance:string;activated:true}> {
 const p = structuredClone(input); validIdentity(p);
 const a = await source.connect(); let b: PoolClient | undefined, brokenA = false, brokenB = false;
 try {
  await a.query('BEGIN'); const origin = await captureLocked(a,p), f = migration(origin,ticket,runtime);
  if (origin.sourceEnabled || targetRecord(origin)) fail();
  const instance = await registerDeploymentCandidate(target,p,ticket,runtime);
  if (f.phase === 'retired' && f.target !== instance) fail();
  b = await target.connect(); await b.query('BEGIN');
  const destination = await captureLocked(b,p), t = targetRecord(destination) ?? fail(), g = migration(destination,ticket,runtime,!destination.sourceEnabled);
  if (t.instance !== instance || t.ticket !== ticket || t.runtime !== runtime || t.content !== f.content || t.schema !== f.schema || g.content !== f.content || g.phase !== 'frozen') fail();
  if (destination.sourceEnabled) {
   if (f.phase !== 'retired' || t.phase !== 'active') fail();
  } else {
   if (t.phase !== 'ready') fail();
   if (f.phase === 'frozen') await a.query('UPDATE atarasy_member.engine_rows SET value=$1 WHERE deployment=$2 AND namespace=$3 AND key=$4',[JSON.stringify({...f,phase:'retired',target:instance}),p.id,freezeNamespace,'current']);
  }
  // If this acknowledgement is lost, target stays disabled and exact retry reads retirement.
  await a.query('COMMIT');
  if (!destination.sourceEnabled) {
   await b.query('UPDATE atarasy_member.engine_rows SET value=$1 WHERE deployment=$2 AND namespace=$3 AND key=$4',[JSON.stringify({...t,phase:'active'}),p.id,targetNamespace,'current']);
   await b.query('UPDATE atarasy_member.control SET enabled=true WHERE id=$1',[p.id]);
  }
  await b.query('COMMIT'); return {instance,activated:true};
 } catch(error) {
  await a.query('ROLLBACK').catch(()=>{brokenA=true;}); if (b) await b.query('ROLLBACK').catch(()=>{brokenB=true;}); throw error;
 } finally { a.release(brokenA); b?.release(brokenB); }
}

const historyNamespace = 'member_writer_history';
/** Abort only a still-frozen source, never a restored candidate or a retired writer. */
export async function abortDeploymentMigration(pool: Pool, input: Identity, ticket: string, runtime: string): Promise<{aborted:true}> {
 const p=structuredClone(input);validIdentity(p);if(!uuid(ticket)||!/^[a-f0-9]{64}$/.test(runtime))fail();
 const c=await pool.connect();let broken=false;
 try{
  await c.query('BEGIN');const snapshot=await captureLocked(c,p);
  const history=snapshot.rows.find(r=>r.namespace===historyNamespace&&r.key===ticket);
  if(history){const h=JSON.parse(history.value);if(h.outcome!=='aborted'||h.migration?.ticket!==ticket||h.migration?.runtime!==runtime)fail();await c.query('COMMIT');return {aborted:true};}
  const f=migration(snapshot,ticket,runtime);
  if(snapshot.sourceEnabled||targetRecord(snapshot)||f.phase!=='frozen')fail();
  await c.query('INSERT INTO atarasy_member.engine_rows (deployment,namespace,key,value) VALUES ($1,$2,$3,$4)',[p.id,historyNamespace,ticket,JSON.stringify({outcome:'aborted',migration:f})]);
  await c.query('DELETE FROM atarasy_member.engine_rows WHERE deployment=$1 AND namespace=$2 AND key=$3',[p.id,freezeNamespace,'current']);
  await c.query('UPDATE atarasy_member.control SET enabled=true WHERE id=$1',[p.id]);
  await captureLocked(c,p);await c.query('COMMIT');return {aborted:true};
 }catch(error){await c.query('ROLLBACK').catch(()=>{broken=true;});throw error;}finally{c.release(broken);}
}
