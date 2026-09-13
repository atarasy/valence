import { afterEach, expect, test } from 'bun:test';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openMemberAuthority } from '../member-read/authority.ts';
import { openVerifiedLogin } from '../member-login/login.ts';
import { credentialSPKI } from '../member-login/credential-key.ts';
import { openMandateBindings } from './mandate-binding.ts';
import { makeEngine } from '../../engine/test/helpers.ts';
const cleanups: (() => void)[] = [];
afterEach(() => { for (const f of cleanups.splice(0).reverse()) f(); });
const digest = (input: string | Buffer) => createHash('sha256').update(input).digest();
function key() {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }), jwk = pair.publicKey.export({ format: 'jwk' });
  const cose = Buffer.concat([Buffer.from('a5010203262001215820','hex'), Buffer.from(jwk.x!, 'base64url'), Buffer.from('225820','hex'), Buffer.from(jwk.y!, 'base64url')]);
  return { pair, cose, pem: pair.publicKey.export({ format: 'pem', type: 'spki' }).toString() };
}
async function setup(mismatch = false) {
  const dir = mkdtempSync(join(tmpdir(), 'mandate-binding-')); cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const clock = { at: 1000 }, origin = 'https://unit.example';
  const authority = openMemberAuthority(join(dir, 'authority.sqlite'), { environment: 'test', audience: origin, maxSessionLifetimeMs: 5000, now: () => clock.at }); cleanups.push(() => authority.close());
  const login = openVerifiedLogin(join(dir, 'login.sqlite'), authority, { environment: 'test', origin, rpID: 'unit.example', challengeLifetimeMs: 1000, sessionLifetimeMs: 4000, now: () => clock.at }); cleanups.push(() => login.close());
  const credential = randomBytes(32).toString('base64url'), user = randomBytes(32).toString('base64url'), keys = key();
  authority.provisionPrincipal('member', 'house', ['merchant-1']); authority.registerCredential(credential, 'member');
  login.provisionVerifiedPasskey(credential, keys.cose, 0, user);
  authority.bindResource({ kind: 'mandate', id: 'tx-mandate' }, { household: 'house' });
  const { engine } = makeEngine(); engine.registerIdentity('tx-mandate', mismatch ? key().pem : keys.pem);
  const flow = login.begin(), client = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: flow.publicKey.challenge, origin }));
  const auth = Buffer.concat([digest('unit.example'), Buffer.from([5, 0, 0, 0, 1])]);
  const signature = sign('sha256', Buffer.concat([auth, digest(client)]), keys.pair.privateKey);
  const session = await login.finish(flow.id, { id: credential, rawId: credential, type: 'public-key', clientExtensionResults: {}, response: { clientDataJSON: client.toString('base64url'), authenticatorData: auth.toString('base64url'), signature: signature.toString('base64url'), userHandle: user } });
  const path = join(dir, 'binding.sqlite');
  const connect = () => { const b = openMandateBindings(path, authority, login, engine); cleanups.push(() => b.close()); return b; };
  return { dir, path, clock, authority, login, engine, credential, keys, user, session, connect, bridge: connect() };
}
test('actual verified login key binds existing engine identity and survives close/reopen', async () => {
  const s = await setup(), before = s.engine.publicKeyFor('tx-mandate');
  const record = s.bridge.bind(s.session.token, 'tx-mandate');
  expect(record.binding).toMatchObject({ principal: 'member', household: 'house', credential: s.credential, mandate: 'tx-mandate' });
  expect(record.binding.fingerprint).toBe(createHash('sha256').update(s.keys.pair.publicKey.export({ format: 'der', type: 'spki' })).digest('hex'));
  s.bridge.close(); const reopened = s.connect();
  expect(reopened.resolve(s.session.token, 'tx-mandate')).toEqual(record);
  expect(reopened.bind(s.session.token, 'tx-mandate')).toEqual(record);
  expect(s.engine.publicKeyFor('tx-mandate')).toBe(before);
  for (const name of readdirSync(s.dir)) expect(readFileSync(join(s.dir, name)).includes(Buffer.from(s.session.token))).toBe(false);
});
test('different engine key cannot bind even with valid login and owned mandate', async () => {
  const s = await setup(true);
  expect(() => s.bridge.bind(s.session.token, 'tx-mandate')).toThrow('Mandate key mismatch');
  expect(() => s.bridge.resolve(s.session.token, 'tx-mandate')).toThrow();
});
test('foreign and absent mandate claims cannot register or overwrite an engine identity', async () => {
  const s = await setup(); s.authority.bindResource({ kind: 'mandate', id: 'foreign' }, { household: 'other-house' }); s.engine.registerIdentity('foreign', s.keys.pem);
  expect(() => s.bridge.bind(s.session.token, 'foreign')).toThrow();
  s.authority.bindResource({ kind: 'mandate', id: 'unregistered' }, { household: 'house' });
  expect(() => s.bridge.bind(s.session.token, 'unregistered')).toThrow(); expect(s.engine.publicKeyFor('unregistered')).toBeUndefined();
  expect(() => s.bridge.bind('amr1_' + 'A'.repeat(43), 'tx-mandate')).toThrow();
});
test('same-household second credential cannot overwrite immutable binding across connections', async () => {
  const s = await setup(); const first = s.bridge.bind(s.session.token, 'tx-mandate'), peer = s.connect();
  expect(peer.bind(s.session.token, 'tx-mandate')).toEqual(first);
  const credential = randomBytes(32).toString('base64url');
  s.authority.registerCredential(credential, 'member'); s.login.provisionVerifiedPasskey(credential, s.keys.cose, 0, s.user);
  // Trusted setup of a second session, distinct from the real verified first ceremony.
  const second = s.authority.createSessionAfterVerification(credential, 4000);
  expect(() => peer.bind(second.token, 'tx-mandate')).toThrow('Immutable mandate binding');
  expect(() => peer.resolve(second.token, 'tx-mandate')).toThrow();
  expect(s.bridge.resolve(s.session.token, 'tx-mandate')).toEqual(first);
});
test('session credential principal ownership and grant revocations block later resolution', async () => {
  for (const change of ['session', 'credential', 'principal', 'ownership', 'grants', 'expiry']) {
    const s = await setup(); s.bridge.bind(s.session.token, 'tx-mandate');
    if (change === 'session') s.authority.revokeSession(s.session.id);
    if (change === 'credential') s.authority.revokeCredential(s.credential);
    if (change === 'principal') s.authority.disablePrincipal('member');
    if (change === 'ownership') s.authority.invalidateResource({ kind: 'mandate', id: 'tx-mandate' });
    if (change === 'grants') s.authority.setPresenterGrants('member', []);
    if (change === 'expiry') s.clock.at = 5000;
    expect(() => s.bridge.resolve(s.session.token, 'tx-mandate')).toThrow();
    expect(() => s.bridge.bind(s.session.token, 'tx-mandate')).toThrow();
  }
});
test('public key and authority snapshots are detached and inactive keys unavailable', async () => {
  const s = await setup(), bytes = s.login.verifiedPublicKey(s.credential)!; bytes.fill(0);
  expect(Buffer.from(s.login.verifiedPublicKey(s.credential)!)).toEqual(s.keys.cose);
  const context = s.authority.transactionContext(s.session.token, 'tx-mandate')!; context.presenters.push('foreign');
  expect(s.authority.transactionContext(s.session.token, 'tx-mandate')!.presenters).toEqual(['merchant-1']);
  const id = randomBytes(32).toString('base64url');
  expect(() => s.login.enrolVerifiedPasskey('missing', id, s.keys.cose, 0, s.user)).toThrow();
  expect(s.login.verifiedPublicKey(id)).toBeUndefined();
});
test('unsupported COSE algorithm coordinates extra fields and trailing bytes are refused', () => {
  const { cose } = key(); expect(credentialSPKI(cose).length).toBeGreaterThan(0);
  const alg = Buffer.from(cose); alg[4] = 0x27;
  const curve = Buffer.from(cose); curve[6] = 2;
  const point = Buffer.from(cose); point.fill(0, 10, 42); point.fill(0, 45);
  for (const bad of [alg, curve, point, Buffer.concat([Buffer.from([0xa6]), cose.subarray(1), Buffer.from([0, 1])]), Buffer.concat([cose, Buffer.from([0])]), cose.subarray(0, 20), Buffer.from([0xa0])]) expect(() => credentialSPKI(bad)).toThrow();
});
test('RP mismatch and later engine-key mismatch cannot resolve a stored binding', async () => {
  const s = await setup(); s.bridge.bind(s.session.token, 'tx-mandate');
  expect(() => openMandateBindings(s.path, s.authority, s.login, { config: { ...s.engine.config, relyingPartyId: 'other.example' }, publicKeyFor: id => s.engine.publicKeyFor(id) })).toThrow('Binding scope mismatch');
  const changed = openMandateBindings(s.path, s.authority, s.login, { config: s.engine.config, publicKeyFor: () => key().pem }); cleanups.push(() => changed.close());
  expect(() => changed.resolve(s.session.token, 'tx-mandate')).toThrow('Mandate key mismatch');
});

test('stored environment scope cannot be reopened under a different configured environment', async () => {
  const s = await setup();
  const authority = { ...s.authority, scope: { ...s.authority.scope, environment: 'other' } };
  const login = { ...s.login, scope: { ...s.login.scope, environment: 'other' } };
  expect(() => openMandateBindings(s.path, authority, login, s.engine)).toThrow('Binding scope mismatch');
  s.bridge.bind(s.session.token, 'tx-mandate');
  const config = { ...s.engine.config };
  const mutableView = openMandateBindings(s.path, s.authority, s.login, { config, publicKeyFor: id => s.engine.publicKeyFor(id) }); cleanups.push(() => mutableView.close());
  config.relyingPartyId = 'changed.example';
  expect(() => mutableView.resolve(s.session.token, 'tx-mandate')).toThrow('Binding scope mismatch');
});
