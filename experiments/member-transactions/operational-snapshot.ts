import { Database } from 'bun:sqlite';
import { mkdirSync, openSync, closeSync, chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import schema from './operational-schema-v1.json';
export const operationalNamespaces = 'offers bare_receipts notes settlements member_statement_confirmations configs edges identities disclosures confirmations root_endorsed reservations mandates recoveries household_settled household_offers delivery permissions permission_actions permission_queries recoverers recovery_channels recovery_log deliberations registry_entries registry_keys'.split(' ');
const tables = 'atomic_meta atomic_rows authority_meta principals credentials sessions ownership login_meta passkeys challenges binding_meta bindings operation_meta operations statement_review_meta statement_reviews'.split(' ');
type Scope = { environment: string; origin: string; rpID: string };
type Snapshot = Record<string, Record<string, any>[]>;
function stable(v: any): string { if (v instanceof Uint8Array) return JSON.stringify({ blob: Buffer.from(v).toString('base64') }); if (v === null || typeof v !== 'object') return JSON.stringify(v); return Array.isArray(v) ? '[' + v.map(stable).join(',') + ']' : '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}'; }
const hash = (v: unknown) => createHash('sha256').update(stable(v)).digest('hex');
const refuse = (): never => { throw new Error('Operational snapshot validation failed'); };
function validate(rows: Snapshot, p: Scope) {
  const only = (table: string) => { if (rows[table]?.length !== 1) refuse(); return rows[table]![0]!; };
  if (only('atomic_meta').scope !== JSON.stringify(['atarasy.local-engine-unit.1', p.environment, p.origin])) refuse();
  const a = only('authority_meta'); if (a.singleton !== 1 || a.version !== 1 || a.environment !== p.environment || a.audience !== p.origin) refuse();
  for (const [name, expected] of [['login_meta',[2,p.environment,p.origin,p.rpID]],['binding_meta',[1,p.environment,p.origin,p.rpID]],['operation_meta',[1,p.environment,p.origin]],['statement_review_meta',[1,p.environment,p.origin,p.rpID]]] as const) if (only(name).scope !== JSON.stringify(expected)) refuse();
  const maps = new Map<string, Map<string, any>>();
  for (const row of rows.atomic_rows!) {
    if (!operationalNamespaces.includes(row.namespace) || typeof row.k !== 'string' || typeof row.v !== 'string') refuse();
    const map = maps.get(row.namespace) ?? new Map(); map.set(row.k, JSON.parse(row.v)); maps.set(row.namespace, map);
  }
  const get = (name: string, key: string) => maps.get(name)?.get(key);
  const principals = new Map(rows.principals!.map(r => [r.id,r])), credentials = new Map(rows.credentials!.map(r => [r.id,r])), passkeys = new Map(rows.passkeys!.map(r => [r.id,r]));
  for (const r of rows.passkeys!) if (!(r.public_key instanceof Uint8Array) || !Number.isSafeInteger(r.counter) || r.counter < 0 || r.counter > 0xffffffff || !Number.isSafeInteger(r.revision) || r.revision < 0 || (r.active && !credentials.has(r.id))) refuse();
  for (const r of rows.bindings!) if (!principals.has(r.principal) || credentials.get(r.credential)?.principal !== r.principal || !passkeys.has(r.credential) || principals.get(r.principal)?.household !== r.household || get('mandates',r.mandate)?.household !== r.household) refuse();
  const candidates = new Set<string>();
  for (const [key,o] of maps.get('offers') ?? []) { if (key !== o.id || !Array.isArray(o.candidates)) refuse(); for (const c of o.candidates) { if (typeof c.id !== 'string' || candidates.has(c.id)) refuse(); candidates.add(c.id); } }
  for (const r of rows.ownership!) { const value = get(r.kind === 'offer' ? 'offers' : 'mandates',r.id); if (!r.invalidated && (!value || value.household !== r.household || (r.kind === 'offer' && value.presenter !== r.presenter))) refuse(); }
  const operations = new Map<string, any>();
  for (const row of rows.operations!) {
    const o = JSON.parse(row.record); operations.set(row.id,o);
    if (o.id !== row.id || o.offer !== row.offer || o.state !== row.state || !get('offers',o.offer) || !get('mandates',o.mandate) || credentials.get(o.credential)?.principal !== o.principal || principals.get(o.principal)?.household !== o.household) refuse();
    const digest = createHash('sha256').update(JSON.stringify(['atarasy.member-operation.1',JSON.stringify([1,p.environment,p.origin]),o.principal,o.credential,o.household,o.keyFingerprint,o.offer,o.mandate,o.presenter,o.canonical,o.reviewedRevision,o.expiresAt])).digest('hex');
    if (o.requestDigest !== digest || o.challenge !== createHash('sha256').update(o.canonical).digest('base64url')) refuse();
    if (o.state === 'committed') {
      const receipt = get('settlements',o.offer), reservation = get('reservations',o.offer);
      if (!receipt || !reservation || !['committed','released'].includes(reservation.status) || (reservation.status === 'committed' && reservation.committed !== receipt.charged)) refuse();
      // Earlier journals used insertion-order JSON; contextual journals use sorted JSON.
      if (o.receiptDigest !== hash(receipt) && o.receiptDigest !== createHash('sha256').update(JSON.stringify(receipt)).digest('hex')) refuse();
    }
  }
  for (const row of rows.statement_reviews!) {
    const o = operations.get(row.operation), review = JSON.parse(row.record);
    if (!o || review.revision !== o.reviewedRevision || review.canonical !== o.canonical || hash(review.sealed) !== o.reviewedRevision) refuse();
    const challenge = createHash('sha256').update(JSON.stringify(['atarasy.member-statement-authorisation.1',JSON.stringify([1,p.environment,p.origin,p.rpID]),o.id,o.requestDigest,o.reviewedRevision])).digest('base64url');
    if (review.challenge !== challenge || (o.state === 'committed' && (!get('member_statement_confirmations',o.offer) || review.verified?.fingerprint !== o.assertionFingerprint))) refuse();
  }
}
function snapshot(db: Database, p: Scope): Snapshot {
  const current = db.query("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type,name").all();
  if (stable(current) !== stable(schema)) refuse();
  const integrity = db.query('PRAGMA integrity_check').all() as Record<string,string>[];
  if (integrity.length !== 1 || Object.values(integrity[0]!)[0] !== 'ok' || db.query('PRAGMA foreign_key_check').all().length) refuse();
  const rows: Snapshot = {};
  for (const name of tables) rows[name] = db.query(`SELECT * FROM "${name}" ORDER BY rowid`).all() as Record<string,any>[];
  validate(rows,p); return rows;
}
/** Complete current-schema candidate. Never fences writers or changes a live path. */
export function createOperationalSnapshot(sourcePath: string, newDirectory: string, scope: Scope) {
  const p = structuredClone(scope);
  if (Object.keys(p).sort().join(',') !== 'environment,origin,rpID' || typeof p.environment !== 'string' || !p.environment || new URL(p.origin).origin !== p.origin || new URL(p.origin).protocol !== 'https:' || new URL(p.origin).hostname !== p.rpID) refuse();
  const source = new Database(sourcePath,{readonly:true}); let rows: Snapshot;
  try { rows = source.transaction(() => snapshot(source,p))(); } finally { source.close(); }
  const digest = hash(rows); mkdirSync(newDirectory,{mode:0o700});
  const destination = join(newDirectory,'candidate.sqlite'); closeSync(openSync(destination,'wx',0o600));
  const target = new Database(destination); let verified = false;
  try {
    target.run('PRAGMA foreign_keys=ON'); target.run('PRAGMA synchronous=FULL');
    target.transaction(() => {
      for (const entry of schema.filter(e => e.type === 'table')) target.run(entry.sql);
      for (const entry of schema.filter(e => e.type === 'index')) target.run(entry.sql);
      for (const name of tables) for (const row of rows[name]!) {
        const keys = Object.keys(row); target.query(`INSERT INTO "${name}" (${keys.map(k=>'"'+k+'"').join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>row[k]));
      }
      const copied = snapshot(target,p); if (hash(copied) !== digest) throw new Error('Snapshot copy differs');
    }).immediate();
    verified = true;
  } finally {
    target.close(); chmodSync(destination,0o600);
    writeFileSync(join(newDirectory,'snapshot.json'),JSON.stringify({profile:'atarasy.operational-snapshot.1',scope:p,digest,verified,cutover:false,rows:Object.fromEntries(tables.map(t=>[t,rows[t]!.length]))},null,2)+'\n',{mode:0o600,flag:'wx'});
  }
  return { destination, digest, verified: true as const, cutover: false as const };
}
