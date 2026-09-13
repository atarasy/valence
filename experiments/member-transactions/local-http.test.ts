import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLocalHTTP } from './local-http.ts';
import { openAtomicStore } from './atomic-store.ts';
import { seedAtomicFixture, localRuntime, atomicScope, fixtureTime } from './atomic-fixture.ts';
import { databaseFor } from './shared-database.ts';
import { EXPORT_FORMAT_VERSION } from '../../engine/src/hub/node.ts';
const cleanup: (() => void)[] = [];
afterEach(() => { for (const f of cleanup.splice(0).reverse()) f(); });
const policy = { environment: 'test', origin: atomicScope.audience, rpID: 'unit.example', explorationRate: 0.2, reminderLimit: 1 as const, recoveryGraceDays: 3, maximumBodyBytes: 100000, maximumResponseBytes: 100000, maximumPending: 8 };
async function setup(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'local-http-')); cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'db.sqlite'), [statement] = await seedAtomicFixture(path), unit = openAtomicStore(path, atomicScope); cleanup.push(() => unit.close());
  const app = openLocalHTTP(path, { ...policy, ...overrides }); cleanup.push(() => app.close());
  const offer = await unit.run(store => localRuntime(store).engine.mustGet(statement!.offer, fixtureTime));
  const request = (route: string, body?: unknown) => new Request(policy.origin + route, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
  return { path, unit, app, offer, statement: statement!, request };
}
test('HTTP writes and fresh reads share persistent candidate lookup', async () => {
  const s = await setup(), candidate = s.offer.candidates[0]!.id;
  const response = await s.app.fetch(s.request(`/candidates/${candidate}/note`, { author: 'house', text: 'Via request', shared_with: ['merchant'] }));
  expect(response.status).toBe(201);
  expect(await s.unit.run(store => localRuntime(store).engine.notesFor(candidate))).toHaveLength(1);
  expect((await s.app.fetch(s.request(`/candidates/${candidate}/note`, { author: 'house', text: 'Again' }))).status).toBe(409);
});
test('router error rolls back an earlier successful import prefix', async () => {
  const s = await setup(), other = structuredClone(s.offer); other.id = 'import-prefix'; other.candidates[0]!.id = 'imported-candidate';
  const response = await s.app.fetch(s.request('/households/house/import', { format: EXPORT_FORMAT_VERSION, offers: [other, s.offer] }));
  expect(response.status).toBe(409);
  expect(await s.unit.run(store => { try { localRuntime(store).engine.mustGet(other.id, fixtureTime); return true; } catch { return false; } })).toBe(false);
});
test('GET expiry writes commit through the same boundary', async () => {
  const s = await setup(), expired = structuredClone(s.offer); expired.id = 'expired-read'; expired.binding = 'digital'; expired.state = 'presented'; expired.expires_at = Date.now() - 1000; expired.candidates[0]!.id = 'expiry-candidate'; expired.candidates[0]!.valence = 'offered';
  await s.unit.run(store => localRuntime(store).engine.importOffer(expired, 'house'));
  expect((await s.app.fetch(s.request('/offers/expired-read'))).status).toBe(200);
  const stored = await s.unit.run((_store, database) => databaseFor(database, atomicScope).db.query("SELECT v FROM atomic_rows WHERE namespace='offers' AND k='expired-read'").get()) as { v: string };
  expect(JSON.parse(stored.v)).toMatchObject({ state: 'expired', candidates: [{ valence: 'returned' }] });
});
test('response limit failure rolls back a successful write before returning failure', async () => {
  const s = await setup({ maximumResponseBytes: 1 }), candidate = s.offer.candidates[0]!.id;
  expect((await s.app.fetch(s.request(`/candidates/${candidate}/note`, { author: 'house', text: 'Must roll back' }))).status).toBe(500);
  expect(await s.unit.run(store => localRuntime(store).engine.notesFor(candidate))).toEqual([]);
});
test('concurrent requests across same and separate instances accept one note', async () => {
  const s = await setup(), second = openLocalHTTP(s.path, policy); cleanup.push(() => second.close());
  const candidate = s.offer.candidates[0]!.id, make = () => s.request(`/candidates/${candidate}/note`, { author: 'house', text: 'Once' });
  const results = await Promise.all([s.app.fetch(make()), s.app.fetch(make()), second.fetch(make())]);
  expect(results.map(r => r.status).sort()).toEqual([201, 409, 409]);
  expect(await s.unit.run(store => localRuntime(store).engine.notesFor(candidate))).toHaveLength(1);
});
test('admission bounds reject excess requests while input is pending and close refuses active work', async () => {
  const s = await setup({ maximumPending: 1 }); let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
  const first = s.app.fetch(new Request(policy.origin + '/unknown', { method: 'POST', body: stream }));
  expect((await s.app.fetch(s.request('/unknown'))).status).toBe(503); expect(() => s.app.close()).toThrow('active');
  controller.close(); expect((await first).status).toBe(404);
  expect((await s.app.fetch(s.request('/unknown'))).status).toBe(404);
});
test('oversized input and foreign origins never execute a write and remote config is rejected', async () => {
  const s = await setup({ maximumBodyBytes: 8 });
  expect((await s.app.fetch(s.request('/unknown', { long: 'x'.repeat(100) }))).status).toBe(413);
  expect((await s.app.fetch(new Request('https://other.example/offers'))).status).toBe(400);
  expect(() => openLocalHTTP(s.path, { ...policy, remoteURL: 'https://other.example' } as typeof policy)).toThrow('policy');
});
test('database failure during note persistence becomes an error response with no partial note', async () => {
  const s = await setup(), candidate = s.offer.candidates[0]!.id;
  await s.unit.run((_store, database) => databaseFor(database, atomicScope).db.run("CREATE TRIGGER fail_note BEFORE INSERT ON atomic_rows WHEN NEW.namespace='notes' BEGIN SELECT RAISE(ABORT,'injected note failure'); END"));
  expect((await s.app.fetch(s.request(`/candidates/${candidate}/note`, { author: 'house', text: 'No write' }))).status).toBe(500);
  expect(await s.unit.run(store => localRuntime(store).engine.notesFor(candidate))).toEqual([]);
});
test('HTTP settlement commits local ledger receipt and day once across repeated requests', async () => {
  const s = await setup(), make = () => s.request(`/offers/${s.offer.id}/settle`, { signature: s.statement.signature, disputed: [] });
  const first = await s.app.fetch(make()); expect(first.status).toBe(200); const receipt = await first.json();
  const second = await s.app.fetch(make()); expect(second.status).toBe(200); expect(await second.json()).toEqual(receipt);
  const saved = await s.unit.run(store => { const r = localRuntime(store); return { receipt: r.engine.settlement(s.offer.id), day: r.engine.householdLedger.forHousehold('house'), ledger: r.ledger.get(s.offer.id) }; });
  expect(saved.receipt).toEqual(receipt); expect(saved.day).toHaveLength(1); expect(saved.ledger?.status).toBe('committed');
});
