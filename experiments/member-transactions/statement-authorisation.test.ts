import type { MemberStatementEnvelope } from '../../engine/src/shared/member-statement.ts';
import { ValenceEngine } from '../../engine/src/engine/offers.ts';
import { InMemoryLedger } from '../../engine/src/engine/ledger.ts';
import { DeliveryRegister } from '../../engine/src/hub/delivery.ts';
import { LocalDeliveries } from '../../engine/src/engine/delivery-source.ts';
import { afterEach, expect, test } from 'bun:test';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openStatementAuthorisations, AUTHORISATION_PROFILE } from './statement-authorisation.ts';
import { openAtomicStore } from './atomic-store.ts';
import { atomicScope, fixtureTime } from './atomic-fixture.ts';
import { seedUnified, unifiedRuntime, inspectUnified, loginResponse } from './unified-fixture.ts';
import { databaseFor } from './shared-database.ts';
import { verifyAssertion } from '../../engine/src/shared/decisions.ts';
const cleanups: (() => void)[] = [];
afterEach(() => { for (const clean of cleanups.splice(0).reverse()) clean(); });
async function setup(zeroCounter = false) {
  const dir = mkdtempSync(join(tmpdir(), 'statement-authorisation-')); cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'local.sqlite'), seeded = await seedUnified(path, zeroCounter ? 0 : 1), unit = openAtomicStore(path, atomicScope); cleanups.push(() => unit.close());
  await unit.run((store, db) => unifiedRuntime(store, db).journal.cancel(seeded.input.token, seeded.input.operation.id));
  const clock = { at: fixtureTime + 1 };
  const policy = { environment: 'test', origin: atomicScope.audience, rpID: 'unit.example', maximumLifetimeMs: 5000, maxSessionLifetimeMs: 10000, now: () => clock.at, engine: { explorationRate: 0.2, reminderLimit: 1 as const, recoveryGraceDays: 3, relyingPartyId: 'unit.example' } };
  const service = openStatementAuthorisations(path, policy); cleanups.push(() => service.close());
  const prepare = () => service.prepare(seeded.input.token, { offer: seeded.input.statement.offer, disputed: [] });
  const inspect = () => unit.run((store, db) => inspectUnified(store, db, seeded.input));
  return { dir, path, ...seeded, unit, clock, policy, service, prepare, inspect };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
type Prepared = Awaited<ReturnType<Fixture['prepare']>>;
function assertion(s: Fixture, prepared: Prepared, options: { counter?: number; flags?: number; origin?: string; rp?: string; challenge?: string; type?: string; crossOrigin?: boolean; otherKey?: boolean } = {}) {
  const hash = (input: string | Buffer) => createHash('sha256').update(input).digest();
  const client = Buffer.from(JSON.stringify({ type: options.type ?? 'webauthn.get', challenge: options.challenge ?? prepared.publicKey.challenge, origin: options.origin ?? atomicScope.audience, ...(options.crossOrigin === undefined ? {} : { crossOrigin: options.crossOrigin }) }));
  const count = Buffer.alloc(4); count.writeUInt32BE(options.counter ?? 2);
  const auth = Buffer.concat([hash(options.rp ?? 'unit.example'), Buffer.from([options.flags ?? 5]), count]);
  const pair = options.otherKey ? generateKeyPairSync('ec', { namedCurve: 'prime256v1' }) : s.pair;
  return { id: s.input.credential, rawId: s.input.credential, type: 'public-key' as const, clientExtensionResults: {}, response: { userHandle: s.user, clientDataJSON: client.toString('base64url'), authenticatorData: auth.toString('base64url'), signature: sign('sha256', Buffer.concat([auth, hash(client)]), pair.privateKey).toString('base64url') } };
}
async function mutate(s: Fixture, namespace: string, key: string, change: (value: any) => void) {
  await s.unit.run((_store, database) => {
    const db = databaseFor(database, atomicScope).db, row = db.query('SELECT v FROM atomic_rows WHERE namespace=? AND k=?').get(namespace, key) as { v: string };
    const value = JSON.parse(row.v); change(value); db.query('UPDATE atomic_rows SET v=? WHERE namespace=? AND k=?').run(JSON.stringify(value), namespace, key);
  });
}
test('preparation freezes actual terms and verifies contextual authorisation without an engine effect', async () => {
  const s = await setup(), prepared = await s.prepare();
  expect(prepared).toMatchObject({ profile: AUTHORISATION_PROFILE, authorisation: 'prepared', operationState: 'prepared', review: { statement: { carriage: 550, lines: [{ amount: 1200, valence: 'consumed' }] }, mandate: { version: 1 } } });
  expect(prepared.publicKey.challenge).not.toBe(createHash('sha256').update(prepared.canonical).digest('base64url'));
  expect(JSON.stringify(prepared)).not.toContain('fixture-delivery');
  expect(await s.prepare()).toEqual(prepared);
  const response = assertion(s, prepared), accepted = await s.service.verify(s.input.token, prepared.operationID, response);
  expect(accepted.authorisation).toBe('verified'); expect((await s.inspect()).counter).toBe(2);
  expect(await s.service.verify(s.input.token, prepared.operationID, response)).toEqual(accepted); expect((await s.inspect()).counter).toBe(2);
  expect(await s.inspect()).toMatchObject({ receipt: null, reservation: { status: 'held' }, state: 'decided', day: [] });
  expect(verifyAssertion(Buffer.from(prepared.canonical), { client_data_json: response.response.clientDataJSON, authenticator_data: response.response.authenticatorData, signature: response.response.signature }, s.pair.publicKey.export({ format: 'pem', type: 'spki' }).toString(), 'unit.example')).toBe(false);
  for (const file of readdirSync(s.dir)) expect(readFileSync(join(s.dir, file)).includes(Buffer.from(s.input.token))).toBe(false);
});
test('wrong scope credential type challenge presence verification or signing key cannot authorise', async () => {
  const s = await setup(), prepared = await s.prepare();
  for (const options of [{ origin: 'https://foreign.example' }, { rp: 'foreign.example' }, { type: 'webauthn.create' }, { flags: 1 }, { flags: 4 }, { crossOrigin: true }, { otherKey: true }, { challenge: createHash('sha256').update(prepared.canonical).digest('base64url') }]) {
    await expect(s.service.verify(s.input.token, prepared.operationID, assertion(s, prepared, options))).rejects.toThrow();
    expect((await s.inspect()).counter).toBe(1);
  }
  const wrong = assertion(s, prepared); wrong.id = wrong.rawId = Buffer.from('other-credential').toString('base64url');
  await expect(s.service.verify(s.input.token, prepared.operationID, wrong)).rejects.toThrow();
  expect((await s.service.verify(s.input.token, prepared.operationID, assertion(s, prepared))).authorisation).toBe('verified');
});
test('changed displayed mandate invalidates the review even with unchanged canonical bytes', async () => {
  const s = await setup(), prepared = await s.prepare(), response = assertion(s, prepared);
  await s.unit.run((store, db) => { const r = unifiedRuntime(store, db), m = r.engine.mandates.get('mandate-1')!; r.engine.mandates.importMandate({ ...m, ceiling_daily: 5000, version: m.version + 1 }); });
  await expect(s.service.verify(s.input.token, prepared.operationID, response)).rejects.toThrow('Review changed');
  expect((await s.inspect()).counter).toBe(1);
});
test('delivery collection and frozen-disclosure changes invalidate old approval', async () => {
  for (const kind of ['delivery', 'recoveries', 'disclosure']) {
    const s = await setup(), prepared = await s.prepare();
    if (kind === 'delivery') await s.unit.run((store, db) => { const d = unifiedRuntime(store, db).deliveries; d.record({ ...d.find(s.input.statement.offer)!, status: 'returned', now: fixtureTime + 2 }); });
    if (kind === 'recoveries') await mutate(s, 'recoveries', s.input.statement.offer, value => { value.collected_at++; });
    if (kind === 'disclosure') await mutate(s, 'offers', s.input.statement.offer, value => { value.disclosures[0].items[0].value = 'changed'; });
    await expect(s.service.verify(s.input.token, prepared.operationID, assertion(s, prepared))).rejects.toThrow();
    expect((await s.inspect()).counter).toBe(1);
  }
});
test('cancellation then identical preparation has a new challenge and refuses the unused old signature', async () => {
  const s = await setup(), first = await s.prepare(), unused = assertion(s, first);
  await s.service.cancel(s.input.token, first.operationID); const second = await s.prepare();
  expect(second.canonical).toBe(first.canonical); expect(second.operationID).not.toBe(first.operationID); expect(second.publicKey.challenge).not.toBe(first.publicKey.challenge);
  await expect(s.service.verify(s.input.token, second.operationID, unused)).rejects.toThrow();
  expect((await s.inspect()).counter).toBe(1);
  expect((await s.service.verify(s.input.token, second.operationID, assertion(s, second))).authorisation).toBe('verified');
});
test('zero-counter credential still cannot reuse an assertion across preparations', async () => {
  const s = await setup(true), first = await s.prepare(), proof = assertion(s, first, { counter: 0 });
  await s.service.verify(s.input.token, first.operationID, proof); expect((await s.inspect()).counter).toBe(0);
  await s.service.cancel(s.input.token, first.operationID); const second = await s.prepare();
  await expect(s.service.verify(s.input.token, second.operationID, proof)).rejects.toThrow();
  expect((await s.service.verify(s.input.token, second.operationID, assertion(s, second, { counter: 0 }))).authorisation).toBe('verified');
});
test('login and authorisation use the same counter and reject a stale counter across ceremonies', async () => {
  const s = await setup(), prepared = await s.prepare(); await s.service.verify(s.input.token, prepared.operationID, assertion(s, prepared));
  const flow = await s.unit.run((store, db) => unifiedRuntime(store, db).login.begin());
  const result = await s.unit.run(async (store, db) => { try { await unifiedRuntime(store, db).login.finish(flow.id, loginResponse(s.pair, s.input.credential, s.user, flow.publicKey.challenge, 2)); return true; } catch { return false; } });
  expect(result).toBe(false); expect((await s.inspect()).counter).toBe(2);
  const next = await s.unit.run((store, db) => unifiedRuntime(store, db).login.begin());
  await s.unit.run((store, db) => unifiedRuntime(store, db).login.finish(next.id, loginResponse(s.pair, s.input.credential, s.user, next.publicKey.challenge, 3)));
  expect((await s.inspect()).counter).toBe(3);
});
test('concurrent login and authorisation with the same counter accept only one', async () => {
  const s = await setup(), prepared = await s.prepare(), flow = await s.unit.run((store, db) => unifiedRuntime(store, db).login.begin());
  const results = await Promise.allSettled([s.service.verify(s.input.token, prepared.operationID, assertion(s, prepared)), s.unit.run((store, db) => unifiedRuntime(store, db).login.finish(flow.id, loginResponse(s.pair, s.input.credential, s.user, flow.publicKey.challenge, 2)))]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1); expect((await s.inspect()).counter).toBe(2);
});
test('expiry cancellation and revocation refuse verification while owned history remains separate', async () => {
  for (const mode of ['expiry', 'cancel', 'revoke']) {
    const s = await setup(), prepared = await s.prepare(), proof = assertion(s, prepared);
    if (mode === 'expiry') s.clock.at += 6000;
    if (mode === 'cancel') await s.service.cancel(s.input.token, prepared.operationID);
    if (mode === 'revoke') await s.unit.run((store, db) => unifiedRuntime(store, db).authority.revokeCredential(s.input.credential));
    await expect(s.service.verify(s.input.token, prepared.operationID, proof)).rejects.toThrow(); expect((await s.inspect()).counter).toBe(1);
    if (mode !== 'revoke') expect((await s.service.read(s.input.token, prepared.operationID)).operationID).toBe(prepared.operationID);
  }
});
test('malformed disputes missing carriage invalid disclosures and nonphysical offers fail preparation', async () => {
  const s = await setup();
  for (const disputed of [['unknown'], [s.input.statement.offer, s.input.statement.offer]]) await expect(s.service.prepare(s.input.token, { offer: s.input.statement.offer, disputed })).rejects.toThrow();
  await s.unit.run((_store, database) => databaseFor(database, atomicScope).db.query("DELETE FROM atomic_rows WHERE namespace='delivery'").run());
  await expect(s.prepare()).rejects.toThrow('Delivery unavailable');
  const other = await setup(); await mutate(other, 'offers', other.input.statement.offer, value => { value.binding = 'digital'; });
  await expect(other.prepare()).rejects.toThrow('Statement unavailable');
});
test('disputed consumed and gifted lines retain exact zero-charge semantics in prepared bytes', async () => {
  const s = await setup();
  const candidate = await s.unit.run((store, db) => unifiedRuntime(store, db).engine.mustGet(s.input.statement.offer).candidates[0]!.id);
  const disputed = await s.service.prepare(s.input.token, { offer: s.input.statement.offer, disputed: [candidate] });
  expect(disputed.canonical).toContain(':consumed:1200:disputed');
  await s.service.cancel(s.input.token, disputed.operationID);
  await mutate(s, 'offers', s.input.statement.offer, value => { value.candidates[0].given_by = 'fixture-giver'; });
  const gift = await s.prepare(); expect(gift.review.statement.lines[0]!.amount).toBe(0); expect(gift.canonical).toContain(':consumed:0:');
});
test('stored reviewed content corruption is detected on read and does not advance the counter', async () => {
  const s = await setup(), prepared = await s.prepare();
  await s.unit.run((_store, database) => {
    const db = databaseFor(database, atomicScope).db, row = db.query('SELECT record FROM statement_reviews WHERE operation=?').get(prepared.operationID) as { record: string };
    const value = JSON.parse(row.record); value.sealed.view.statement.carriage = 999;
    db.query('UPDATE statement_reviews SET record=? WHERE operation=?').run(JSON.stringify(value), prepared.operationID);
  });
  await expect(s.service.read(s.input.token, prepared.operationID)).rejects.toThrow('inconsistent');
  expect((await s.inspect()).counter).toBe(1);
});
test('review write failure rolls back the verified credential counter and authorisation together', async () => {
  const s = await setup(), prepared = await s.prepare();
  await s.unit.run((_store, database) => databaseFor(database, atomicScope).db.run("CREATE TRIGGER fail_review_update BEFORE UPDATE ON statement_reviews BEGIN SELECT RAISE(ABORT,'injected review write'); END"));
  await expect(s.service.verify(s.input.token, prepared.operationID, assertion(s, prepared))).rejects.toThrow('injected review write');
  expect((await s.inspect()).counter).toBe(1); expect((await s.service.read(s.input.token, prepared.operationID)).authorisation).toBe('prepared');
});
test('two service instances accept an identical proof once even for zero counters', async () => {
  for (const zero of [false, true]) {
    const s = await setup(zero), prepared = await s.prepare(), proof = assertion(s, prepared, { counter: zero ? 0 : 2 });
    const second = openStatementAuthorisations(s.path, s.policy); cleanups.push(() => second.close());
    const result = await Promise.all([s.service.verify(s.input.token, prepared.operationID, proof), second.verify(s.input.token, prepared.operationID, proof)]);
    expect(result[0]).toEqual(result[1]); expect(result[0]!.authorisation).toBe('verified');
    const row = await s.unit.run((_store, database) => databaseFor(database, atomicScope).db.query('SELECT revision FROM passkeys WHERE id=?').get(s.input.credential));
    expect(row).toEqual({ revision: 2 });
  }
});

test('contextual settlement commits counter claim ledger day receipt and outcome together with exact read-back', async () => {
  const s = await setup(), p = await s.prepare(), proof = assertion(s, p);
  const result = await s.service.settle(s.input.token, p.operationID, proof);
  expect(result).toMatchObject({ operationID: p.operationID, operationState: 'committed', receipt: { charged: 1200, confirmation: proof.response.signature } });
  const state = await s.inspect();
  expect(state).toMatchObject({ counter: 2, state: 'settled', reservation: { status: 'committed' } });
  expect(state.day).toHaveLength(1);
  expect((await s.service.read(s.input.token, p.operationID)).operationState).toBe('committed');
  s.clock.at += 6000;
  expect(await s.service.settle(s.input.token, p.operationID, proof)).toEqual(result);
  expect((await s.inspect()).day).toHaveLength(1);
  await expect(s.service.settle(s.input.token, p.operationID, assertion(s, p, { counter: 3 }))).rejects.toThrow('conflict');
});
test('previously verified proof settles without a second counter increment or device ceremony', async () => {
  const s = await setup(), p = await s.prepare(), proof = assertion(s, p);
  await s.service.verify(s.input.token, p.operationID, proof);
  expect((await s.service.settle(s.input.token, p.operationID, proof)).receipt.charged).toBe(1200);
  const row = await s.unit.run((_store, database) => databaseFor(database, atomicScope).db.query('SELECT revision FROM passkeys WHERE id=?').get(s.input.credential));
  expect(row).toEqual({ revision: 2 });
});
test('outcome write failure rolls back every local settlement effect and allows the same proof after repair', async () => {
  const s = await setup(), p = await s.prepare(), proof = assertion(s, p);
  await s.unit.run((_store, database) => databaseFor(database, atomicScope).db.run("CREATE TRIGGER fail_outcome BEFORE UPDATE ON operations WHEN NEW.state='committed' BEGIN SELECT RAISE(ABORT,'injected outcome failure'); END"));
  await expect(s.service.settle(s.input.token, p.operationID, proof)).rejects.toThrow('injected outcome failure');
  expect(await s.inspect()).toMatchObject({ counter: 1, receipt: null, state: 'decided', day: [], reservation: { status: 'held' } });
  expect(await s.service.read(s.input.token, p.operationID)).toMatchObject({ operationState: 'prepared', authorisation: 'prepared' });
  await s.unit.run((_store, database) => databaseFor(database, atomicScope).db.run('DROP TRIGGER fail_outcome'));
  expect((await s.service.settle(s.input.token, p.operationID, proof)).receipt.charged).toBe(1200);
});
test('engine proof identity write failure rolls back the receipt ledger and credential', async () => {
  const s = await setup(), p = await s.prepare();
  await s.unit.run((_store, database) => databaseFor(database, atomicScope).db.run("CREATE TRIGGER fail_identity BEFORE INSERT ON atomic_rows WHEN NEW.namespace='member_statement_confirmations' BEGIN SELECT RAISE(ABORT,'injected identity failure'); END"));
  await expect(s.service.settle(s.input.token, p.operationID, assertion(s, p))).rejects.toThrow('injected identity failure');
  expect(await s.inspect()).toMatchObject({ counter: 1, receipt: null, state: 'decided', day: [], reservation: { status: 'held' } });
});
test('concurrent local settlement instances return one committed outcome for zero and increasing counters', async () => {
  for (const zero of [false, true]) {
    const s = await setup(zero), p = await s.prepare(), proof = assertion(s, p, { counter: zero ? 0 : 2 });
    const second = openStatementAuthorisations(s.path, s.policy); cleanups.push(() => second.close());
    const results = await Promise.all([s.service.settle(s.input.token, p.operationID, proof), second.settle(s.input.token, p.operationID, proof)]);
    expect(results[0]).toEqual(results[1]); expect((await s.inspect()).day).toHaveLength(1);
    expect((await s.inspect()).counter).toBe(zero ? 0 : 2);
  }
});
test('accepted approval does not bypass fresh review expiry or revoked access at settlement', async () => {
  for (const mode of ['review', 'expiry', 'revocation']) {
    const s = await setup(), p = await s.prepare(), proof = assertion(s, p);
    await s.service.verify(s.input.token, p.operationID, proof);
    if (mode === 'review') await s.unit.run((store, db) => { const r = unifiedRuntime(store, db), m = r.engine.mandates.get('mandate-1')!; r.engine.mandates.importMandate({ ...m, ceiling_daily: 5000, version: m.version + 1 }); });
    if (mode === 'expiry') s.clock.at += 6000;
    if (mode === 'revocation') await s.unit.run((store, db) => unifiedRuntime(store, db).authority.revokeCredential(s.input.credential));
    await expect(s.service.settle(s.input.token, p.operationID, proof)).rejects.toThrow();
    expect(await s.inspect()).toMatchObject({ counter: 2, receipt: null, state: 'decided', day: [], reservation: { status: 'held' } });
  }
});
test('disputed consumed lines settle at zero and release the reservation under contextual approval', async () => {
  const s = await setup(), candidate = await s.unit.run((store, db) => unifiedRuntime(store, db).engine.mustGet(s.input.statement.offer).candidates[0]!.id);
  const p = await s.service.prepare(s.input.token, { offer: s.input.statement.offer, disputed: [candidate] });
  expect((await s.service.settle(s.input.token, p.operationID, assertion(s, p))).receipt).toMatchObject({ charged: 0, disputed_amount: 1200 });
  expect((await s.inspect()).reservation?.status).toBe('released');
});
async function engineEnvelope(s: Fixture, p: Prepared): Promise<MemberStatementEnvelope> {
  const operation = await s.unit.run((store, db) => unifiedRuntime(store, db).journal.read(s.input.token, p.operationID));
  const { id, principal, credential, household, keyFingerprint, offer, mandate, presenter, canonical, reviewedRevision, expiresAt, requestDigest } = operation;
  return { profile: AUTHORISATION_PROFILE, environment: 'test', origin: atomicScope.audience, rpID: 'unit.example', id, principal, credential, household, keyFingerprint, offer, mandate, presenter, canonical, reviewedRevision, expiresAt, requestDigest };
}
function contextualEngine(s: Fixture, store: Parameters<Parameters<Fixture['unit']['run']>[0]>[0]) {
  const engine = new ValenceEngine(new InMemoryLedger(store), { ...s.policy.engine, memberStatementScope: { environment: 'test', origin: atomicScope.audience } }, store);
  engine.readDeliveriesFrom(new LocalDeliveries(new DeliveryRegister(store)));
  return engine;
}
const engineProof = (proof: ReturnType<typeof assertion>) => ({ authenticator_data: proof.response.authenticatorData, client_data_json: proof.response.clientDataJSON, signature: proof.response.signature });
test('engine public contextual entry verifies envelope scope terms expiry and proof independently of member verifier', async () => {
  const s = await setup(), p = await s.prepare(), e = await engineEnvelope(s, p), proof = assertion(s, p);
  for (const change of [{ profile: 'unknown' }, { environment: 'other' }, { origin: 'https://other.example' }, { rpID: 'other.example' }, { id: 'other-operation' }, { principal: 'other-person' }, { credential: 'other-credential' }, { household: 'other-household' }, { mandate: 'other-mandate' }, { presenter: 'other-presenter' }, { canonical: p.canonical + '\n' }, { reviewedRevision: '0'.repeat(64) }, { keyFingerprint: '0'.repeat(64) }, { requestDigest: '0'.repeat(64) }, { expiresAt: fixtureTime }, { extra: true }]) {
    await expect(s.unit.run((store, db) => {
      const r = { engine: contextualEngine(s, store) };
      return r.engine.settleMemberStatement({ ...e, ...change } as typeof e, engineProof(proof), [], s.clock.at);
    })).rejects.toThrow('Invalid contextual');
  }
  for (const options of [{ origin: 'https://other.example' }, { rp: 'other.example' }, { type: 'webauthn.create' }, { flags: 1 }, { flags: 4 }, { crossOrigin: true }, { otherKey: true }]) {
    await expect(s.unit.run((store, db) => {
      const r = { engine: contextualEngine(s, store) };
      return r.engine.settleMemberStatement(e, engineProof(assertion(s, p, options)), [], s.clock.at);
    })).rejects.toThrow('Invalid contextual');
  }
  await expect(s.unit.run((store, db) => unifiedRuntime(store, db).engine.settleMemberStatement(e, engineProof(proof), [], s.clock.at))).rejects.toThrow('Invalid contextual');
  expect(await s.inspect()).toMatchObject({ counter: 1, receipt: null, reservation: { status: 'held' }, day: [] });
});
test('engine preserves exact contextual operation identity across fresh runtimes and refuses legacy replay', async () => {
  const s = await setup(), p = await s.prepare(), e = await engineEnvelope(s, p), proof = engineProof(assertion(s, p));
  const call = () => s.unit.run((store, db) => { const r = { engine: contextualEngine(s, store) }; return r.engine.settleMemberStatement(e, proof, [], s.clock.at); });
  const result = await call(); expect(await call()).toEqual(result);
  await expect(s.unit.run((store, db) => unifiedRuntime(store, db).engine.settle(e.offer, s.clock.at, { signed: { assertion: proof } }))).rejects.toThrow('different operation');
  const other = { ...e, id: 'another-operation' };
  const challenge = createHash('sha256').update(JSON.stringify([other.profile, JSON.stringify([1, other.environment, other.origin, other.rpID]), other.id, other.requestDigest, other.reviewedRevision])).digest('base64url');
  await expect(s.unit.run((store, db) => { const r = { engine: contextualEngine(s, store) }; return r.engine.settleMemberStatement(other, engineProof(assertion(s, p, { challenge })), [], s.clock.at); })).rejects.toThrow('different operation');
  expect((await s.inspect()).day).toHaveLength(1);
});
