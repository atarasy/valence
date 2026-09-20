import { createHash } from 'node:crypto';
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
 const s = validate(input,expected), c = await pool.connect(); let broken = false;
 try {
  await c.query('BEGIN');
  if (await schemaDigest(c) !== s.schema) fail();
  // Primary-key insertion fences concurrent restorers and refuses every existing deployment.
  await c.query('INSERT INTO atarasy_member.control (id,environment,origin,epoch,enabled) VALUES ($1,$2,$3,$4,false)',[s.identity.id,s.identity.environment,s.identity.origin,s.identity.epoch]);
  for (const row of s.rows) await c.query('INSERT INTO atarasy_member.engine_rows (deployment,namespace,key,value) VALUES ($1,$2,$3,$4)',[s.identity.id,row.namespace,row.key,row.value]);
  const actual = await c.query<Row>('SELECT namespace,key,value FROM atarasy_member.engine_rows WHERE deployment=$1 ORDER BY ordinal',[s.identity.id]);
  if (JSON.stringify(actual.rows) !== JSON.stringify(s.rows)) fail();
  await c.query('COMMIT'); return {verified:true,enabled:false,digest:s.digest};
 } catch(error) { await c.query('ROLLBACK').catch(()=>{broken=true;}); throw error; } finally { c.release(broken); }
}

const freezeNamespace = 'member_writer_migration';
type FrozenWriter = { profile: 'atarasy.postgres-writer-freeze.1'; ticket: string; runtime: string; phase: 'frozen'; content: string; schema: string };
/** Stop the source and capture its final state atomically. A retry must name the same ticket and runtime. */
export async function freezeDeployment(pool: Pool, input: Identity, ticket: string, runtime: string): Promise<DeploymentSnapshot> {
 const p = structuredClone(input); validIdentity(p);
 if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(ticket) || !/^[a-f0-9]{64}$/.test(runtime)) fail();
 const c = await pool.connect(); let broken = false;
 try {
  await c.query('BEGIN');
  const before = await captureLocked(c,p), records = before.rows.filter(r => r.namespace === freezeNamespace);
  if (records.length) {
   if (records.length !== 1 || records[0]!.key !== 'current' || before.sourceEnabled) fail();
   const held = JSON.parse(records[0]!.value) as FrozenWriter;
   if (!held || Object.keys(held).sort().join(',') !== 'content,phase,profile,runtime,schema,ticket' || held.profile !== 'atarasy.postgres-writer-freeze.1' || held.phase !== 'frozen' || held.ticket !== ticket || held.runtime !== runtime || held.schema !== before.schema || held.content !== sha(before.rows.filter(r => r.namespace !== freezeNamespace))) fail();
   await c.query('COMMIT'); return before;
  }
  // An unrelated administrative disable is not a migration ticket.
  if (!before.sourceEnabled) fail();
  const frozen: FrozenWriter = { profile: 'atarasy.postgres-writer-freeze.1', ticket, runtime, phase: 'frozen', content: sha(before.rows), schema: before.schema };
  await c.query('INSERT INTO atarasy_member.engine_rows (deployment,namespace,key,value) VALUES ($1,$2,$3,$4)',[p.id,freezeNamespace,'current',JSON.stringify(frozen)]);
  await c.query('UPDATE atarasy_member.control SET enabled=false WHERE id=$1',[p.id]);
  const final = await captureLocked(c,p);
  await c.query('COMMIT'); return final;
 } catch(error) { await c.query('ROLLBACK').catch(()=>{broken=true;}); throw error; } finally { c.release(broken); }
}
