import { databaseFor } from './shared-database.ts';
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { Store } from '../../engine/src/common/store.ts';
import { ValenceEngine } from '../../engine/src/engine/offers.ts';
import { InMemoryLedger } from '../../engine/src/engine/ledger.ts';
import { RecoveryRegister, exportNode } from '../../engine/src/hub/node.ts';
import { PermissionLedger } from '../../engine/src/hub/permissions.ts';
import { DeliveryRegister } from '../../engine/src/hub/delivery.ts';
import { verifyDisclosure } from '../../engine/src/shared/disclosure.ts';
import { openAtomicStore } from './atomic-store.ts';
import { openLocalHTTP } from './local-http.ts';
import { validateNodeImport } from './node-import.ts';
const stable = (v: any): string => v === null || typeof v !== 'object' ? JSON.stringify(v) : Array.isArray(v) ? '[' + v.map(stable).join(',') + ']' : '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
export function archiveDigest(node: unknown) { const { exported_at: _time, ...content } = node as Record<string, unknown>; return createHash('sha256').update(stable(content)).digest('hex'); }
type Policy = Parameters<typeof openLocalHTTP>[1];
function exported(store: Store, p: Policy, household: string, at: number) {
  const engine = new ValenceEngine(new InMemoryLedger(store), { explorationRate: p.explorationRate, reminderLimit: p.reminderLimit, recoveryGraceDays: p.recoveryGraceDays, relyingPartyId: p.rpID }, store);
  const node = validateNodeImport(exportNode(engine, new RecoveryRegister(store), new PermissionLedger(store), engine.mandates, new DeliveryRegister(store), household, at), household);
  for (const o of node.offers) {
    const config = engine.configsForPresenter(o.presenter).find(c => c.version === o.config_version);
    if (!config || o.candidates.some(c => { const p = config.products[c.product]; return !p || p.price !== c.unit_price || p.merchant !== c.merchant || p.maker !== c.maker || p.ships !== c.ships; })) throw new Error('Archive catalogue mismatch');
    for (const d of o.disclosures) { const key = engine.publicKeyFor(d.merchant); if (!key || !verifyDisclosure(d, key)) throw new Error('Archive disclosure invalid'); }
  }
  return node;
}
/** Archive rehearsal only: source is read-only; destination directory must not exist. */
export async function rehearseNodeImport(sourcePath: string, destinationDirectory: string, household: string, policy: Policy, at: number) {
  if (!Number.isSafeInteger(at) || at < 0) throw new Error('Invalid archive time');
  const p = structuredClone(policy), scope = { environment: p.environment, audience: p.origin };
  const source = new Database(sourcePath, { readonly: true });
  let rows: { namespace: string; k: string; v: string }[];
  try {
    rows = source.transaction(() => {
      const meta = source.query('SELECT scope FROM atomic_meta').all() as { scope: string }[];
      if (meta.length !== 1 || meta[0]!.scope !== JSON.stringify(['atarasy.local-engine-unit.1', p.environment, p.origin])) throw new Error('Archive source scope mismatch');
      return source.query('SELECT namespace,k,v FROM atomic_rows ORDER BY rowid').all() as { namespace: string; k: string; v: string }[];
    })();
  } finally { source.close(); }
  const snapshot: Store = { map<T>(name: string) { return new Map<string, T>(rows.filter(r => r.namespace === name).map(r => [r.k, JSON.parse(r.v)])); }, close() {} };
  const node = exported(snapshot, p, household, at), before = archiveDigest(node);
  if (node.offers.length === 0) throw new Error('Archive household has no offers');
  // An exclusive directory avoids replacing a DB or attaching stale WAL files.
  mkdirSync(destinationDirectory, { mode: 0o700 });
  const destination = join(destinationDirectory, 'archive.sqlite'), unit = openAtomicStore(destination, scope);
  try {
    await unit.run(store => {
      for (const namespace of ['identities', 'root_endorsed', 'configs', 'disclosures']) {
        const map = store.map(namespace);
        for (const r of rows.filter(r => r.namespace === namespace)) map.set(r.k, JSON.parse(r.v));
      }
    });
    const app = openLocalHTTP(destination, p);
    try {
      const response = await app.fetch(new Request(p.origin + '/households/' + encodeURIComponent(household) + '/import', { method: 'POST', body: JSON.stringify(node) }));
      if (!response.ok) throw new Error('Archive import refused');
    } finally { app.close(); }
    const after = await unit.run(store => exported(store, p, household, at));
    if (archiveDigest(after) !== before) throw new Error('Archive round-trip mismatch');
    await unit.run((_store, database) => { const db = databaseFor(database, scope).db; db.run('CREATE TABLE archive_rehearsal_meta(mode TEXT NOT NULL,digest TEXT NOT NULL)'); db.query('INSERT INTO archive_rehearsal_meta VALUES (?,?)').run('archive-only', before); });
    return { mode: 'archive-only' as const, destination, household, digest: before, verified: true as const, operationalCutover: false as const, offers: node.offers.length };
  } finally {
    unit.close();
    // Even a failed rehearsal must not look like a ready operational store.
    const marker = new Database(destination);
    try { marker.run('CREATE TABLE IF NOT EXISTS archive_rehearsal_meta(mode TEXT NOT NULL,digest TEXT NOT NULL)'); if (!(marker.query('SELECT mode FROM archive_rehearsal_meta').get())) marker.query('INSERT INTO archive_rehearsal_meta VALUES (?,?)').run('archive-incomplete', before); }
    finally { marker.close(); }
  }
}
