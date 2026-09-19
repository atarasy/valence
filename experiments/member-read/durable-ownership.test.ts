import { nameOf } from '../../engine/src/common/names.ts';
import { afterEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openMemberAuthority } from './authority.ts';
import { openDurableOwnership } from './durable-ownership.ts';
import { memberReadBoundary } from './gate.ts';
import { openStore } from '../../engine/src/common/store.ts';
import { ValenceEngine, canonicalConfig } from '../../engine/src/engine/offers.ts';
import { InMemoryLedger } from '../../engine/src/engine/ledger.ts';
import { canonicalMandate } from '../../engine/src/hub/mandates.ts';
import { createApp } from '../../engine/src/http.ts';
import { ApprovalDesk } from '../../engine/src/hub/approval.ts';
import { RecoveryRegister } from '../../engine/src/hub/node.ts';
import { PermissionLedger } from '../../engine/src/hub/permissions.ts';
import { Registry } from '../../engine/src/shared/registry.ts';
import { DeliveryRegister } from '../../engine/src/hub/delivery.ts';
const cleanups: (() => void)[] = [];
afterEach(() => { for (const fn of cleanups.splice(0).reverse()) fn(); });
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'durable-ownership-')); cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'engine.sqlite'), store = openStore(path); cleanups.push(() => store.close());
  const engine = new ValenceEngine(new InMemoryLedger(), { explorationRate: 0.2, reminderLimit: 1, recoveryGraceDays: 3, relyingPartyId: 'unit.example' }, store);
  const pair = generateKeyPairSync('ed25519'), pem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  // §13.2, question 55. A household is the name of its key and a mandate hangs
  // from that identifier, so the two households here are two keys.
  const OWN = nameOf(pem), FOREIGN = nameOf(generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString());
  const OWN_MANDATE = `${OWN}.1`;
  engine.registerIdentity(OWN, pem);
  engine.registerIdentity('presenter', pem, true);
  const config = { version: 'catalogue', presenter: 'presenter', products: { tea: { merchant: 'merchant', maker: 'maker', ships: 'carrier', price: 100 } } };
  engine.registerConfig(config, sign(null, canonicalConfig(config), pair.privateKey).toString('base64'));
  const create = (household: string) => engine.createOffer({ binding: 'digital', household, purpose: 'replenish', config_version: config.version, expires_at: Date.now() + 3600000, mandate: `${household}.1`, price_band: null, giver: null, candidates: [{ product: 'tea', quantity: 1, predicted_conversion: 0.5, is_exploration: true, given_by: null }] });
  const own = create(OWN), foreign = create(FOREIGN);
  const mandate = { id: OWN_MANDATE, household: OWN, ceiling_out_of_network: 1000, ceiling_daily: null, cooling_seconds: null, co_signers: [], lapses_at: Date.now() + 3600000, version: 1 };
  engine.mandates.record({ mandate, signatures: { [OWN]: sign(null, canonicalMandate(mandate, 'unit.example'), pair.privateKey).toString('base64') }, assertions: {}, keyOf: () => pem, relyingPartyId: 'unit.example' });
  const authority = openMemberAuthority(join(dir, 'authority.sqlite'), { environment: 'test', audience: 'https://unit.example', maxSessionLifetimeMs: 5000, now: () => 1000 }); cleanups.push(() => authority.close());
  authority.provisionPrincipal('member', OWN, ['presenter']); authority.registerCredential('credential', 'member');
  const session = authority.createSessionAfterVerification('credential', 5000);
  const ownership = openDurableOwnership(path, authority); cleanups.push(() => ownership.close());
  const sql = new Database(path); cleanups.push(() => sql.close());
  const handler = createApp(engine, { deliveries: new DeliveryRegister(), approvals: new ApprovalDesk(), recovery: new RecoveryRegister(), permissions: new PermissionLedger(), registry: new Registry() });
  let calls = 0;
  const boundary = memberReadBoundary({ environment: 'test', origin: 'https://unit.example', now: () => 1000, resolveSession: authority.resolveSession, ownerOf: ownership.ownerOf, next: async request => { calls++; return handler(request); } });
  const read = (route: string) => boundary(new Request('https://unit.example' + route, { headers: { authorization: 'Bearer ' + session.token } }));
  return { OWN, FOREIGN, OWN_MANDATE, path, own, foreign, authority, ownership, sql, read, calls: () => calls };
}

test('actual persisted offer and signed mandate establish ownership without caller provisioning', async () => {
  const { OWN, FOREIGN, OWN_MANDATE, own, foreign, authority, read, calls } = setup();
  expect(await authority.ownerOf({ kind: 'offer', id: own.id })).toBeUndefined();
  const result = await read('/offers/' + own.id); expect(result.status).toBe(200); expect((await result.json()).household).toBe(OWN);
  expect(await authority.ownerOf({ kind: 'offer', id: own.id })).toEqual({ household: OWN, presenter: 'presenter' });
  expect((await read('/_node/mandates/' + encodeURIComponent(OWN_MANDATE))).status).toBe(200);
  const list = await read('/offers?household=' + encodeURIComponent(OWN) + '&presenter=presenter');
  expect(list.status).toBe(200); expect((await list.json()).offers.map((item: { id: string }) => item.id)).toEqual([own.id]);
  const denied = await read('/offers/' + foreign.id), absent = await read('/offers/missing');
  expect(denied.status).toBe(404); expect(await denied.text()).toBe(await absent.text()); expect(calls()).toBe(3);
});

test('deleted persisted rows invalidate cached bindings despite the engine memory retaining the offer', async () => {
  const { OWN, FOREIGN, OWN_MANDATE, own, read, sql, authority, ownership } = setup();
  expect((await read('/offers/' + own.id)).status).toBe(200);
  const row = sql.query('SELECT v FROM offers WHERE k=?').get(own.id) as { v: string };
  sql.query('DELETE FROM offers WHERE k=?').run(own.id);
  expect((await read('/offers/' + own.id)).status).toBe(404);
  expect(await authority.ownerOf({ kind: 'offer', id: own.id })).toBeUndefined();
  sql.query('INSERT INTO offers VALUES (?,?)').run(own.id, row.v);
  await expect(ownership.ownerOf({ kind: 'offer', id: own.id })).rejects.toThrow();
});

test('conflicting persisted ownership is tombstoned and cannot be silently rebound', async () => {
  const { OWN, FOREIGN, OWN_MANDATE, own, read, sql, authority } = setup(); expect((await read('/offers/' + own.id)).status).toBe(200);
  const row = sql.query('SELECT v FROM offers WHERE k=?').get(own.id) as { v: string };
  sql.query('UPDATE offers SET v=? WHERE k=?').run(JSON.stringify({ ...JSON.parse(row.v), household: FOREIGN }), own.id);
  expect((await read('/offers/' + own.id)).status).toBe(503);
  expect(await authority.ownerOf({ kind: 'offer', id: own.id })).toBeUndefined();
  sql.query('UPDATE offers SET v=? WHERE k=?').run(row.v, own.id);
  expect((await read('/offers/' + own.id)).status).toBe(503);
});

test('corrupt and closed sources fail neutrally before reaching the handler', async () => {
  const { OWN, FOREIGN, OWN_MANDATE, own, read, sql, ownership, calls } = setup();
  for (const value of ['broken JSON', JSON.stringify({ id: 'wrong', household: OWN, presenter: 'presenter' })]) {
    sql.query('UPDATE offers SET v=? WHERE k=?').run(value, own.id);
    const result = await read('/offers/' + own.id); expect(result.status).toBe(503); expect(await result.text()).not.toContain('JSON');
  }
  ownership.close(); expect((await read('/offers/' + own.id)).status).toBe(503); expect(calls()).toBe(0);
});

test('uncommitted new ownership is invisible; committed records are reconciled on the next read', async () => {
  const { OWN, FOREIGN, OWN_MANDATE, own, sql, ownership } = setup(); const row = sql.query('SELECT v FROM offers WHERE k=?').get(own.id) as { v: string };
  sql.run('BEGIN IMMEDIATE');
  try {
    sql.query('INSERT INTO offers VALUES (?,?)').run('new-resource', JSON.stringify({ ...JSON.parse(row.v), id: 'new-resource' }));
    expect(await ownership.ownerOf({ kind: 'offer', id: 'new-resource' })).toBeUndefined();
    sql.run('COMMIT');
  } catch (error) { sql.run('ROLLBACK'); throw error; }
  expect(await ownership.ownerOf({ kind: 'offer', id: 'new-resource' })).toEqual({ household: OWN, presenter: 'presenter' });
});
