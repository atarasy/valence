import { afterEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openMemberAuthority } from './authority.ts';
import { memberReadBoundary } from './gate.ts';
import fixtures from './reference-fixtures.json';
import { makeEngine, CONFIG_VERSION } from '../../engine/test/helpers.ts';
import { createApp } from '../../engine/src/http.ts';
import { ApprovalDesk } from '../../engine/src/hub/approval.ts';
import { RecoveryRegister } from '../../engine/src/hub/node.ts';
import { PermissionLedger } from '../../engine/src/hub/permissions.ts';
import { Registry } from '../../engine/src/shared/registry.ts';

const offer = fixtures['digital-offer'];
const options = { environment: 'test', audience: 'https://unit.example', maxSessionLifetimeMs: 10_000, now: () => 1000 };
const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'member-authority-')); cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'authority.sqlite');
  const connect = (overrides = {}) => { const store = openMemberAuthority(path, { ...options, ...overrides }); cleanups.push(() => store.close()); return store; };
  const store = connect();
  store.provisionPrincipal('member', offer.household, [offer.presenter]);
  store.registerCredential('credential', 'member');
  store.bindResource({ kind: 'offer', id: offer.id }, { household: offer.household, presenter: offer.presenter });
  return { dir, path, connect, store };
}
function gate(store: ReturnType<typeof openMemberAuthority>, next = async () => new Response(JSON.stringify(offer), { headers: { 'content-type': 'application/json' } })) {
  const handler = memberReadBoundary({ environment: options.environment, origin: options.audience, now: options.now, resolveSession: store.resolveSession, ownerOf: store.ownerOf, next });
  return (token: string, path = '/offers/' + offer.id) => handler(new Request(options.audience + path, { headers: { authorization: 'Bearer ' + token } }));
}

test('opaque sessions and immutable ownership survive actual close/reopen without storing token secrets', async () => {
  const { store, connect, dir } = setup();
  const issued = store.createSessionAfterVerification('credential', 5000);
  const another = store.createSessionAfterVerification('credential', 5000);
  expect(issued.token).not.toBe(another.token);
  expect(issued.id).not.toBe(another.id);
  expect(issued.token).toMatch(/^amr1_[A-Za-z0-9_-]{43}$/);
  store.close();
  const reopened = connect();
  expect((await gate(reopened)(issued.token)).status).toBe(200);
  expect(await reopened.ownerOf({ kind: 'offer', id: offer.id })).toEqual({ household: offer.household, presenter: offer.presenter });
  for (const file of readdirSync(dir)) {
    const contents = readFileSync(join(dir, file));
    expect(contents.includes(Buffer.from(issued.token))).toBe(false);
    expect(contents.includes(Buffer.from(another.token))).toBe(false);
  }
});

test('unknown, malformed and revoked sessions never forward; expiry is enforced', async () => {
  const { store, connect } = setup();
  const session = store.createSessionAfterVerification('credential', 2000);
  let calls = 0; const read = gate(store, async () => { calls++; throw new Error('unexpected dispatch'); });
  for (const token of ['unknown', 'amr1_' + 'a'.repeat(43), session.token + 'x']) expect((await read(token)).status).toBe(401);
  const expired = connect({ now: () => 2000 });
  expect(await expired.resolveSession(session.token)).toBeUndefined();
  store.revokeSession(session.id);
  expect((await read(session.token)).status).toBe(401);
  expect(await connect().resolveSession(session.token)).toBeUndefined();
  expect(calls).toBe(0);
});

test('issuance requires an active provisioned credential and bounded future expiry', () => {
  const { store } = setup();
  expect(() => store.createSessionAfterVerification('unknown', 5000)).toThrow();
  for (const expires of [1000, 999, 11_001, NaN, Infinity, 1500.1]) expect(() => store.createSessionAfterVerification('credential', expires)).toThrow();
  expect(store.createSessionAfterVerification('credential', 11_000).expiresAt).toBe(11_000);
  store.revokeCredential('credential');
  expect(() => store.createSessionAfterVerification('credential', 5000)).toThrow();
});

test('credential and principal revocation are terminal across independent connections', async () => {
  for (const action of ['credential', 'principal'] as const) {
    const { store, connect } = setup(); const peer = connect();
    const issued = store.createSessionAfterVerification('credential', 5000);
    if (action === 'credential') peer.revokeCredential('credential'); else peer.disablePrincipal('member');
    expect(await store.resolveSession(issued.token)).toBeUndefined();
    expect(() => store.createSessionAfterVerification('credential', 5000)).toThrow();
    expect(() => store.registerCredential('credential', 'member')).toThrow();
    if (action === 'principal') expect(() => store.registerCredential('new-credential', 'member')).toThrow();
    expect(() => store.provisionPrincipal('member', 'different-household', [])).toThrow();
  }
});

test('grant changes revoke existing sessions and fresh verified issuance receives only current grants', async () => {
  const { store, connect } = setup(); const peer = connect();
  const old = store.createSessionAfterVerification('credential', 5000);
  peer.setPresenterGrants('member', ['new-presenter']);
  expect(await store.resolveSession(old.token)).toBeUndefined();
  const fresh = store.createSessionAfterVerification('credential', 5000);
  expect((await store.resolveSession(fresh.token))!.presenters).toEqual(['new-presenter']);
  expect((await gate(store)(fresh.token)).status).toBe(404);
  peer.setPresenterGrants('member', ['new-presenter', 'new-presenter']);
  expect(await store.resolveSession(fresh.token)).toBeDefined();
});

test('failed grant and revocation transaction rolls back both changes', async () => {
  const { store, path } = setup(); const session = store.createSessionAfterVerification('credential', 5000);
  const fault = new Database(path); cleanups.push(() => fault.close());
  fault.run("CREATE TRIGGER injected_failure BEFORE UPDATE ON sessions BEGIN SELECT RAISE(ABORT, 'injected storage failure'); END;");
  expect(() => store.setPresenterGrants('member', ['other'])).toThrow();
  const restored = await store.resolveSession(session.token);
  expect(restored!.presenters).toEqual([offer.presenter]);
  expect((await gate(store)(session.token)).status).toBe(200);
  fault.run('DROP TRIGGER injected_failure');
  store.setPresenterGrants('member', ['other']);
  expect(await store.resolveSession(session.token)).toBeUndefined();
});

test('resource kinds are separate, ownership is immutable, and invalidation cannot be reversed', async () => {
  const { store, connect } = setup(); const resource = { kind: 'offer', id: offer.id } as const;
  store.bindResource(resource, { household: offer.household, presenter: offer.presenter });
  expect(() => store.bindResource(resource, { household: 'other', presenter: offer.presenter })).toThrow();
  expect(() => store.bindResource(resource, { household: offer.household, presenter: 'other' })).toThrow();
  expect(() => store.bindResource({ kind: 'mandate', id: offer.id }, { household: 'other', presenter: 'forged' })).toThrow();
  store.bindResource({ kind: 'mandate', id: offer.id }, { household: 'other' });
  expect(await store.ownerOf({ kind: 'mandate', id: offer.id })).toEqual({ household: 'other' });
  connect().invalidateResource(resource);
  expect(await store.ownerOf(resource)).toBeUndefined();
  expect(() => store.bindResource(resource, { household: offer.household, presenter: offer.presenter })).toThrow();
  expect(await connect().ownerOf(resource)).toBeUndefined();
});

test('foreign and missing durable bindings have the same neutral denial without forwarding', async () => {
  const { store } = setup(); const session = store.createSessionAfterVerification('credential', 5000);
  store.bindResource({ kind: 'offer', id: 'foreign' }, { household: 'other', presenter: offer.presenter });
  let calls = 0; const read = gate(store, async () => { calls++; throw new Error('unexpected dispatch'); });
  const missing = await read(session.token, '/offers/missing'), foreign = await read(session.token, '/offers/foreign');
  expect(missing.status).toBe(404); expect(foreign.status).toBe(404);
  expect(await missing.text()).toBe(await foreign.text()); expect(calls).toBe(0);
});

test('suspended reads discard private responses after a second connection commits authority changes', async () => {
  for (const action of ['session', 'credential', 'principal', 'grants', 'ownership'] as const) {
    const { store, connect } = setup(); const peer = connect(); const session = store.createSessionAfterVerification('credential', 5000);
    let release!: () => void, started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const wait = new Promise<void>(resolve => { release = resolve; });
    const read = gate(store, async () => { started(); await wait; return new Response(JSON.stringify(offer), { headers: { 'content-type': 'application/json' } }); });
    const pending = read(session.token); await ready;
    if (action === 'session') peer.revokeSession(session.id);
    if (action === 'credential') peer.revokeCredential('credential');
    if (action === 'principal') peer.disablePrincipal('member');
    if (action === 'grants') peer.setPresenterGrants('member', []);
    if (action === 'ownership') peer.invalidateResource({ kind: 'offer', id: offer.id });
    release(); const result = await pending;
    expect(result.status).toBe(404); expect(await result.text()).not.toContain(offer.id);
    expect(result.headers.get('cache-control')).toBe('no-store');
  }
});

test('scope mismatch and unknown schema fail without changing existing authority', async () => {
  const { store, path } = setup(); const issued = store.createSessionAfterVerification('credential', 5000);
  for (const mismatch of [{ environment: 'other' }, { audience: 'https://other.example' }]) expect(() => openMemberAuthority(path, { ...options, ...mismatch })).toThrow();
  expect(await store.resolveSession(issued.token)).toBeDefined();
  const inspect = new Database(path); cleanups.push(() => inspect.close());
  inspect.run('UPDATE authority_meta SET version=999');
  expect(() => openMemberAuthority(path, options)).toThrow();
  const unknown = join(path + '-unknown'); const wrong = new Database(unknown); wrong.run('CREATE TABLE unrelated (id TEXT)'); wrong.close();
  expect(() => openMemberAuthority(unknown, options)).toThrow();
});

test('detached records cannot mutate authority and closed dependency fails neutrally', async () => {
  const { store } = setup(); const issued = store.createSessionAfterVerification('credential', 5000);
  const resolved = (await store.resolveSession(issued.token))!;
  resolved.household = 'forged'; (resolved.presenters as string[]).push('forged');
  const owner = (await store.ownerOf({ kind: 'offer', id: offer.id }))!; owner.household = 'forged';
  expect((await gate(store)(issued.token)).status).toBe(200);
  store.close(); const failure = await gate(store)(issued.token);
  expect(failure.status).toBe(503); expect(await failure.text()).not.toContain('SQLite');
});


test('reopened authority gates actual engine own, foreign and list reads', async () => {
  const { store, connect } = setup();
  const { engine, deliveries } = makeEngine();
  const make = (household: string) => engine.createOffer({ binding: 'digital', household, purpose: 'replenish', config_version: CONFIG_VERSION, expires_at: Date.now() + 3600000, mandate: 'mandate-1', price_band: null, giver: null, candidates: [{ product: 'tea-a', quantity: 1, predicted_conversion: 0.5, is_exploration: true, given_by: null }] });
  const own = make('actual-own'), foreign = make('actual-foreign');
  await engine.present(own.id); await engine.present(foreign.id);
  store.provisionPrincipal('actual-member', own.household, [own.presenter]);
  store.registerCredential('actual-credential', 'actual-member');
  for (const resource of [own, foreign]) store.bindResource({ kind: 'offer', id: resource.id }, { household: resource.household, presenter: resource.presenter });
  const session = store.createSessionAfterVerification('actual-credential', 5000);
  store.close(); const reopened = connect();
  const handler = createApp(engine, { deliveries, approvals: new ApprovalDesk(), recovery: new RecoveryRegister(), permissions: new PermissionLedger(), registry: new Registry() });
  let calls = 0;
  const protectedHandler = memberReadBoundary({ environment: options.environment, origin: options.audience, now: options.now, resolveSession: reopened.resolveSession, ownerOf: reopened.ownerOf, next: async request => { calls++; return handler(request); } });
  const get = (path: string) => protectedHandler(new Request(options.audience + path, { headers: { authorization: 'Bearer ' + session.token } }));
  const result = await get('/offers/' + own.id); expect(result.status).toBe(200); expect((await result.json()).id).toBe(own.id);
  expect((await get('/offers/' + foreign.id)).status).toBe(404); expect(calls).toBe(1);
  const list = await get('/offers?household=' + own.household + '&presenter=' + own.presenter);
  expect(list.status).toBe(200); expect((await list.json()).offers.map((item: { id: string }) => item.id)).toEqual([own.id]);
  connect().revokeCredential('actual-credential');
  expect((await get('/offers/' + own.id)).status).toBe(401); expect(calls).toBe(2);
});

test('credential revocation is scoped while principal grant changes revoke all of its credentials', async () => {
  const { store } = setup();
  store.registerCredential('second-credential', 'member');
  store.provisionPrincipal('other-member', 'other-household', ['other-presenter']);
  store.registerCredential('other-credential', 'other-member');
  expect(() => store.registerCredential('credential', 'other-member')).toThrow();
  const first = store.createSessionAfterVerification('credential', 5000);
  const second = store.createSessionAfterVerification('second-credential', 5000);
  const other = store.createSessionAfterVerification('other-credential', 5000);
  store.revokeCredential('credential');
  expect(await store.resolveSession(first.token)).toBeUndefined();
  expect(await store.resolveSession(second.token)).toBeDefined();
  expect(await store.resolveSession(other.token)).toBeDefined();
  store.setPresenterGrants('member', []);
  expect(await store.resolveSession(second.token)).toBeUndefined();
  expect((await store.resolveSession(other.token))!.household).toBe('other-household');
});
