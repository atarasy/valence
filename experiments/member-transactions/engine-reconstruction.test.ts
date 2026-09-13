import { afterEach, expect, test } from 'bun:test';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openStore, type Store } from '../../engine/src/common/store.ts';
import { canonical } from '../../engine/src/shared/lineage.ts';
import { openAtomicStore } from './atomic-store.ts';
import { atomicScope, fixtureTime, localRuntime, seedAtomicFixture } from './atomic-fixture.ts';
import { databaseFor } from './shared-database.ts';
const cleanup: (() => void)[] = [];
afterEach(() => { for (const f of cleanup.splice(0).reverse()) f(); });
function path() { const d = mkdtempSync(join(tmpdir(), 'engine-reconstruction-')); cleanup.push(() => rmSync(d, { recursive: true, force: true })); return join(d, 'db.sqlite'); }
async function fixture() {
  const file = path(), [statement] = await seedAtomicFixture(file), unit = openAtomicStore(file, atomicScope); cleanup.push(() => unit.close());
  const offer = await unit.run(store => localRuntime(store).engine.mustGet(statement!.offer, fixtureTime));
  return { file, unit, offer, candidate: offer.candidates[0]!.id };
}
function signedEdge(store: Store) {
  const { engine } = localRuntime(store), pair = generateKeyPairSync('ed25519');
  engine.registerIdentity('giver', pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(), true);
  const input = { from: 'giver', to: 'recipient', product: 'tea-0', merchant: 'maker-a', maker: 'made-by-tea', kind: 'gift' as const, occasion: 'thanks', receipt: 'merchant-proof' };
  const edge = engine.acceptEdge({ ...input, signature: sign(null, canonical(input), pair.privateKey).toString('base64'), now: fixtureTime });
  return { edge, receipts: engine.receiptsFor('recipient'), key: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString() };
}
test('fresh unified runtime resolves stored candidates for notes and preserves duplicate-author refusal', async () => {
  const s = await fixture();
  const note = await s.unit.run(store => localRuntime(store).engine.addNote({ candidate: s.candidate, author: 'house', text: 'Useful', shared_with: ['merchant'], now: fixtureTime }));
  expect(await s.unit.run(store => localRuntime(store).engine.notesSharedWith(s.candidate, 'merchant'))).toEqual([note]);
  await expect(s.unit.run(store => localRuntime(store).engine.addNote({ candidate: s.candidate, author: 'house', text: 'Again', shared_with: [] }))).rejects.toThrow('one line');
  await expect(s.unit.run(store => localRuntime(store).engine.addNote({ candidate: 'missing', author: 'house', text: 'No', shared_with: [] }))).rejects.toThrow('no candidate');
});
test('signed lineage retains exact opaque receipts and gift recognition across fresh runtimes', async () => {
  const s = await fixture(), accepted = await s.unit.run(store => signedEdge(store));
  expect(accepted.receipts).toHaveLength(1); expect(Object.keys(accepted.receipts[0]!).sort()).toEqual(['at', 'ref']); expect(accepted.receipts[0]!.ref).not.toBe(accepted.edge.id);
  for (let i = 0; i < 3; i++) {
    const next = await s.unit.run(store => { const e = localRuntime(store).engine; const rows = e.receiptsFor('recipient'); expect(rows).toEqual(accepted.receipts); rows[0]!.at = 0; rows.push({ ref: 'injected', at: 0 }); return { receipts: e.receiptsFor('recipient'), known: e.hasBeenGiven('recipient', 'tea-0'), edges: e.edgesTouching('recipient') }; });
    expect(next).toEqual({ receipts: accepted.receipts, known: true, edges: [accepted.edge] });
  }
});
test('imported offers notes edges and explicit receipt references survive reconstruction without minting receipts', async () => {
  const s = await fixture(), accepted = await s.unit.run(store => signedEdge(store));
  const target = openAtomicStore(path(), atomicScope); cleanup.push(() => target.close());
  await target.run(store => {
    const e = localRuntime(store).engine;
    e.importOffer(s.offer, 'house'); e.importNote({ candidate: s.candidate, author: 'previous-author', text: 'Moved note', shared_with: [], created_at: fixtureTime }); e.registerIdentity('giver', accepted.key, true); e.importEdge(accepted.edge, 'recipient');
    expect(e.receiptsFor('recipient')).toEqual([]);
    const rows = structuredClone(accepted.receipts); e.importReceipts('recipient', rows); rows[0]!.ref = 'caller-mutated';
  });
  const result = await target.run(store => { const e = localRuntime(store).engine; const note = e.addNote({ candidate: s.candidate, author: 'house', text: 'After move', shared_with: [], now: fixtureTime }); return { note, receipts: e.receiptsFor('recipient'), edges: e.edgesTouching('recipient') }; });
  expect(result.receipts).toEqual(accepted.receipts); expect(result.edges).toEqual([accepted.edge]); expect(result.note.candidate).toBe(s.candidate);
  expect(await target.run(store => localRuntime(store).engine.notesFor(s.candidate))).toHaveLength(2);
});
test('ambiguous candidate imports fail before adding an offer or changing existing lookup', async () => {
  const s = await fixture();
  for (const within of [false, true]) {
    const other = structuredClone(s.offer); other.id = within ? 'within-duplicate' : 'across-duplicate';
    if (within) { other.candidates[0]!.id = 'new-candidate'; other.candidates.push(structuredClone(other.candidates[0]!)); }
    await s.unit.run(store => {
      const e = localRuntime(store).engine;
      expect(() => e.importOffer(other, 'house')).toThrow('unambiguous');
      expect(() => e.mustGet(other.id, fixtureTime)).toThrow();
    });
  }
  expect((await s.unit.run(store => localRuntime(store).engine.addNote({ candidate: s.candidate, author: 'owner', text: 'Still resolves', shared_with: [] }))).candidate).toBe(s.candidate);
});
test('ambiguous persisted candidates are refused at startup instead of silently selecting an owner', async () => {
  const s = await fixture();
  await s.unit.run((_store, database) => { const other = structuredClone(s.offer); other.id = 'corrupt-copy'; databaseFor(database, atomicScope).db.query('INSERT INTO atomic_rows VALUES (?,?,?)').run('offers', other.id, JSON.stringify(other)); });
  await expect(s.unit.run(store => localRuntime(store).engine.receiptsFor('recipient'))).rejects.toThrow('unambiguous');
});
test('receipt write failure rolls back signed lineage and its identity registration together', async () => {
  const s = await fixture();
  await s.unit.run((_store, database) => databaseFor(database, atomicScope).db.run("CREATE TRIGGER fail_bare_receipt BEFORE INSERT ON atomic_rows WHEN NEW.namespace='bare_receipts' BEGIN SELECT RAISE(ABORT,'injected bare receipt failure'); END"));
  await expect(s.unit.run(store => signedEdge(store))).rejects.toThrow('injected bare receipt failure');
  expect(await s.unit.run(store => { const e = localRuntime(store).engine; return { edges: e.edgesTouching('recipient'), receipts: e.receiptsFor('recipient'), key: e.publicKeyFor('giver') ?? null }; })).toEqual({ edges: [], receipts: [], key: null });
});
test('ordinary store reopen preserves exact receipts and imported candidate lookup', async () => {
  const s = await fixture(), file = path(), first = openStore(file);
  const e = localRuntime(first).engine; e.importOffer(s.offer, 'house'); e.importReceipts('house', [{ ref: 'exported-opaque-reference', at: fixtureTime }]); first.close();
  const second = openStore(file); try {
    const reopened = localRuntime(second).engine;
    expect(reopened.receiptsFor('house')).toEqual([{ ref: 'exported-opaque-reference', at: fixtureTime }]);
    expect(reopened.addNote({ candidate: s.candidate, author: 'house', text: 'After reopen', shared_with: [] }).candidate).toBe(s.candidate);
  } finally { second.close(); }
});
test('legacy missing receipt history stays unavailable rather than being recreated from an edge', async () => {
  const s = await fixture(); await s.unit.run(store => signedEdge(store));
  await s.unit.run((_store, database) => databaseFor(database, atomicScope).db.query("DELETE FROM atomic_rows WHERE namespace='bare_receipts'").run());
  expect(await s.unit.run(store => { const e = localRuntime(store).engine; return { edges: e.edgesTouching('recipient').length, receipts: e.receiptsFor('recipient') }; })).toEqual({ edges: 1, receipts: [] });
});
