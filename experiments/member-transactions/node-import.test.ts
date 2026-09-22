import { HOUSE } from './atomic-fixture.ts';
import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { openLocalHTTP } from './local-http.ts';
import { validateNodeImport } from './node-import.ts';
import { rehearseNodeImport } from './node-rehearsal.ts';
import { seedAtomicFixture, settleFixture, atomicScope, fixtureTime } from './atomic-fixture.ts';
import { openAtomicStore } from './atomic-store.ts';
const cleanup: (() => void)[] = [];
afterEach(() => { for (const f of cleanup.splice(0).reverse()) f(); });
const policy = { environment: 'test', origin: atomicScope.audience, rpID: 'unit.example', explorationRate: 0.2, reminderLimit: 1 as const, recoveryGraceDays: 3, maximumBodyBytes: 4 * 1024 * 1024, maximumResponseBytes: 4 * 1024 * 1024, maximumPending: 8 };
async function fixture(settled = false) {
  const dir = mkdtempSync(join(tmpdir(), 'archive-rehearsal-')); cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const source = join(dir, 'source.sqlite'); const [statement] = await seedAtomicFixture(source);
  // §14.2 and §6.4, question 57. A move leaves behind what still has money to
  // move, so an archive that must round-trip whole is one whose box has settled.
  if (settled) { const unit = openAtomicStore(source, atomicScope); try { await unit.run(store => settleFixture(store, statement!)); } finally { unit.close(); } }
  const app = openLocalHTTP(source, policy); cleanup.push(() => app.close());
  const response = await app.fetch(new Request(policy.origin + `/households/${encodeURIComponent(HOUSE)}/export`)); expect(response.status).toBe(200);
  return { dir, source, app, node: await response.json() };
}
function rows(path: string) { const db = new Database(path, { readonly: true }); try { return db.query('SELECT namespace,k,v FROM atomic_rows ORDER BY namespace,k').all(); } finally { db.close(); } }
test('current archive is accepted exactly without sharing caller objects', async () => {
  const s = await fixture(), validated = validateNodeImport(s.node, HOUSE); expect(validated).toEqual(s.node);
  validated.receipts.push({ ref: 'separate', at: 0 }); expect(s.node.receipts).toEqual([]);
});
test('unknown nested fields malformed numbers missing dependencies and duplicate identities are refused', async () => {
  const s = await fixture();
  const changes = [(n: any) => { n.unknown = true; }, (n: any) => { n.offers[0].candidates[0].price_override = 1; }, (n: any) => { delete n.mandates; }, (n: any) => { n.household = 'foreign'; }, (n: any) => { n.offers[0].household = 'foreign'; }, (n: any) => { n.mandates[0].household = 'foreign'; }, (n: any) => { n.offers.push(structuredClone(n.offers[0])); }, (n: any) => { n.offers[0].candidates[0].quantity = 0; }, (n: any) => { n.offers[0].candidates[0].unit_price = 1.5; }, (n: any) => { n.collections = []; }, (n: any) => { n.deliveries[0].offer = 'dangling'; }, (n: any) => { n.collections[0].consumed = ['dangling']; }, (n: any) => { n.offers[0].candidates[0].lineage = 'dangling'; }, (n: any) => { n.receipts = [{ ref: 'r', at: 0, product: 'leak' }]; }, (n: any) => { n.notes = [{ candidate: 'dangling', author: HOUSE, text: 'x', shared_with: [], created_at: 0 }]; }];
  for (const change of changes) { const node = structuredClone(s.node); change(node); expect(() => validateNodeImport(node, HOUSE)).toThrow('Invalid'); }
});
test('a disclosure in an archive may carry a signed contact of exactly a kind and a value (question 72)', async () => {
  const s = await fixture();
  const withContact = (contact: unknown) => { const node = structuredClone(s.node); for (const o of node.offers) for (const d of o.disclosures) d.contact = contact; return node; };
  expect(s.node.offers.some((o: any) => o.disclosures.length > 0)).toBe(true);
  for (const ok of [null, { kind: 'email', value: 'help@shop.example' }]) expect(() => validateNodeImport(withContact(ok), HOUSE)).not.toThrow();
  for (const bad of [{ kind: 'sms', value: 'x' }, { kind: 'email' }, { kind: 'url', value: 'https://x', extra: 1 }]) expect(() => validateNodeImport(withContact(bad), HOUSE)).toThrow('Invalid');
});
test('HTTP preflight rejects malformed archive before touching an existing store', async () => {
  const s = await fixture(), before = rows(s.source), malformed = structuredClone(s.node); malformed.receipts = [{ ref: 'r', at: 0, product: 'leak' }];
  const response = await s.app.fetch(new Request(policy.origin + `/households/${encodeURIComponent(HOUSE)}/import`, { method: 'POST', body: JSON.stringify(malformed) }));
  expect(response.status).toBe(400); expect(rows(s.source)).toEqual(before);
});
test('read-only source rehearses into a fresh archive with equal exports and refuses overwrite', async () => {
  const s = await fixture(true), before = rows(s.source), dest = join(s.dir, 'destination');
  const result = await rehearseNodeImport(s.source, dest, HOUSE, policy, fixtureTime + 1);
  expect(result).toMatchObject({ mode: 'archive-only', verified: true, operationalCutover: false, offers: 1 }); expect(result.digest).toHaveLength(64); expect(rows(s.source)).toEqual(before);
  const target = rows(result.destination);
  await expect(rehearseNodeImport(s.source, dest, HOUSE, policy, fixtureTime + 1)).rejects.toThrow(); expect(rows(result.destination)).toEqual(target);
  expect(() => openLocalHTTP(result.destination, policy)).toThrow('Unknown atomic store schema');
  expect(target.some((r: any) => r.namespace === 'reservations')).toBe(false);
});
test('scope mismatch and invalid frozen disclosure refuse rehearsal before creating a destination', async () => {
  const s = await fixture(), dest = join(s.dir, 'refused');
  await expect(rehearseNodeImport(s.source, dest, HOUSE, { ...policy, environment: 'foreign' }, fixtureTime)).rejects.toThrow('scope'); expect(existsSync(dest)).toBe(false);
  const db = new Database(s.source); const row = db.query("SELECT k,v FROM atomic_rows WHERE namespace='offers'").get() as { k: string; v: string }; const offer = JSON.parse(row.v); offer.disclosures[0].items[0].value = 'tampered'; db.query("UPDATE atomic_rows SET v=? WHERE namespace='offers' AND k=?").run(JSON.stringify(offer), row.k); db.close();
  await expect(rehearseNodeImport(s.source, dest, HOUSE, policy, fixtureTime)).rejects.toThrow('disclosure'); expect(existsSync(dest)).toBe(false);
});
test('settled archive checks receipt arithmetic and preserves exact receipt in rehearsal', async () => {
  const s = await fixture();
  // The seeded fixture exposes its trusted signature through the actual canonical bytes.
  const { sign } = await import('node:crypto'); const { MANDATE_PAIR } = await import('../../engine/test/helpers.ts');
  const { canonicalStatement, statementLines } = await import('../../engine/src/shared/statement.ts');
  const offer = s.node.offers[0]; const signature = sign(null, canonicalStatement(offer.id, s.node.deliveries[0].carriage, statementLines(offer, [])), MANDATE_PAIR.privateKey).toString('base64');
  expect((await s.app.fetch(new Request(policy.origin + '/offers/' + offer.id + '/settle', { method: 'POST', body: JSON.stringify({ signature }) }))).status).toBe(200);
  const node = await (await s.app.fetch(new Request(policy.origin + `/households/${encodeURIComponent(HOUSE)}/export`))).json(); expect(validateNodeImport(node, HOUSE).settlements).toHaveLength(1);
  for (const change of [(n: any) => { n.settlements[0].charged++; }, (n: any) => { n.settlements[0].lines[0].amount++; }, (n: any) => { n.settlements[0].confirmation = null; }, (n: any) => { n.settlements[0].payer = 'foreign'; }]) { const bad = structuredClone(node); change(bad); expect(() => validateNodeImport(bad, HOUSE)).toThrow(); }
  expect((await rehearseNodeImport(s.source, join(s.dir, 'settled-archive'), HOUSE, policy, fixtureTime + 1)).verified).toBe(true);
});
test('failed archive import leaves no offers and marks the destination unavailable for operational use', async () => {
  const s = await fixture(), dest = join(s.dir, 'incomplete');
  await expect(rehearseNodeImport(s.source, dest, HOUSE, { ...policy, maximumBodyBytes: 1 }, fixtureTime)).rejects.toThrow('refused');
  expect(rows(join(dest, 'archive.sqlite')).some((r: any) => r.namespace === 'offers')).toBe(false);
  expect(() => openLocalHTTP(join(dest, 'archive.sqlite'), policy)).toThrow('Unknown atomic store schema');
});

test('decision protections survive an archive and cannot name an unrelated offer', async () => {
  const s = await fixture(true);
  const key = s.node.offers[0].id;
  expect(s.node.decided_protections[key]).toBeDefined();
  s.node.decided_protections[key].stale = ['cooling_seconds'];
  expect(validateNodeImport(s.node, HOUSE).decided_protections).toEqual(s.node.decided_protections);
  for (const change of [
    (n: any) => { n.decided_protections.foreign = n.decided_protections[key]; },
    (n: any) => { n.decided_protections[key].at = -1; },
    (n: any) => { n.decided_protections[key].cooling_seconds = '3600'; },
    (n: any) => { n.decided_protections[key].stale = ['unknown']; },
    (n: any) => { n.decided_protections[key].authority = 'injected'; },
    (n: any) => { delete n.decided_protections; },
  ]) {
    const bad = structuredClone(s.node); change(bad);
    expect(() => validateNodeImport(bad, HOUSE)).toThrow('Invalid node archive');
  }
  const previous = structuredClone(s.node); previous.format = 'valence-node/7'; delete previous.decided_protections;
  expect(validateNodeImport(previous, HOUSE).decided_protections).toEqual({});
});

test('quotation archives require the new register and bind every quote to a digital offer', async () => {
  const s = await fixture();
  expect(s.node.format).toBe('valence-node/9');
  expect(s.node.carriage_quotes).toEqual([]);
  const legacy = structuredClone(s.node); legacy.format = 'valence-node/8'; delete legacy.carriage_quotes;
  expect(validateNodeImport(legacy, HOUSE).carriage_quotes).toEqual([]);
  const absent = structuredClone(s.node); delete absent.carriage_quotes;
  expect(() => validateNodeImport(absent, HOUSE)).toThrow();
  for (const quote of [{offer:s.node.offers[0].id,carriage:0,quoted_at:0},{offer:'foreign',carriage:1,quoted_at:1}]) {
    const changed = structuredClone(s.node); changed.carriage_quotes = [quote];
    expect(() => validateNodeImport(changed, HOUSE)).toThrow();
  }
});
