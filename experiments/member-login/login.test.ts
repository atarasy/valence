import { afterEach, expect, test } from 'bun:test';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { openVerifiedLogin } from './login.ts';
import { openMemberAuthority } from '../member-read/authority.ts';
import { memberReadBoundary } from '../member-read/gate.ts';
import fixtures from '../member-read/reference-fixtures.json';
const offer = fixtures['digital-offer'];
const cleanups: (() => void)[] = [];
afterEach(() => { for (const fn of cleanups.splice(0).reverse()) fn(); });
const hash = (data: string | Buffer) => createHash('sha256').update(data).digest();
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'verified-login-')); cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const state = { at: 1000 };
  const authority = openMemberAuthority(join(dir, 'authority.sqlite'), { environment: 'test', audience: 'https://login.example', maxSessionLifetimeMs: 5000, now: () => state.at }); cleanups.push(() => authority.close());
  const policy = { environment: 'test', origin: 'https://login.example', rpID: 'login.example', challengeLifetimeMs: 1000, sessionLifetimeMs: 4000, now: () => state.at };
  const connect = () => { const login = openVerifiedLogin(join(dir, 'login.sqlite'), authority, policy); cleanups.push(() => login.close()); return login; };
  const login = connect();
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = pair.publicKey.export({ format: 'jwk' });
  // Independent fixture COSE_Key: EC2, ES256, P-256, x and y. No production verifier is reimplemented.
  const cose = Buffer.concat([Buffer.from('a5010203262001215820', 'hex'), Buffer.from(jwk.x!, 'base64url'), Buffer.from('225820', 'hex'), Buffer.from(jwk.y!, 'base64url')]);
  const credentialID = randomBytes(32).toString('base64url'), userHandle = randomBytes(32).toString('base64url');
  authority.provisionPrincipal('member', offer.household, [offer.presenter]); authority.registerCredential(credentialID, 'member');
  authority.bindResource({ kind: 'offer', id: offer.id }, { household: offer.household, presenter: offer.presenter });
  login.provisionVerifiedPasskey(credentialID, cose, 0, userHandle);
  function assertion(challenge: string, changes: { origin?: string; rp?: string; type?: string; flags?: number; counter?: number; userHandle?: string; key?: typeof pair.privateKey; crossOrigin?: boolean } = {}): AuthenticationResponseJSON {
    const client = Buffer.from(JSON.stringify({ type: changes.type ?? 'webauthn.get', challenge, origin: changes.origin ?? policy.origin, ...(changes.crossOrigin ? { crossOrigin: true, topOrigin: 'https://foreign.example' } : {}) }));
    const count = Buffer.alloc(4); count.writeUInt32BE(changes.counter ?? 1);
    const auth = Buffer.concat([hash(changes.rp ?? policy.rpID), Buffer.from([changes.flags ?? 5]), count]);
    const signature = sign('sha256', Buffer.concat([auth, hash(client)]), changes.key ?? pair.privateKey);
    return { id: credentialID, rawId: credentialID, type: 'public-key', clientExtensionResults: {}, response: { clientDataJSON: client.toString('base64url'), authenticatorData: auth.toString('base64url'), signature: signature.toString('base64url'), userHandle: changes.userHandle ?? userHandle } };
  }
  return { dir, state, policy, authority, login, connect, assertion, credentialID, cose, userHandle };
}

test('real ES256 assertion issues a session that unlocks the member read gate', async () => {
  const { login, assertion, authority } = setup(); const flow = login.begin();
  const session = await login.finish(flow.id, assertion(flow.publicKey.challenge));
  const read = memberReadBoundary({ environment: 'test', origin: 'https://login.example', now: () => 1000, resolveSession: authority.resolveSession, ownerOf: authority.ownerOf, next: async () => new Response(JSON.stringify(offer), { headers: { 'content-type': 'application/json' } }) });
  const result = await read(new Request('https://login.example/offers/' + offer.id, { headers: { authorization: 'Bearer ' + session.token } }));
  expect(result.status).toBe(200); expect((await result.json()).id).toBe(offer.id);
  expect(flow.publicKey.userVerification).toBe('required'); expect(flow.publicKey.allowCredentials).toEqual([]);
});

test('wrong challenge origin RP type flags user handle and signing key cannot issue sessions', async () => {
  const { login, assertion } = setup();
  for (const change of [
    { origin: 'https://foreign.example' }, { rp: 'foreign.example' }, { type: 'payment.get' },
    { flags: 1 }, { flags: 4 }, { flags: 0 }, { userHandle: 'Zm9yZ2Vk' },
    { key: generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey }, { crossOrigin: true },
  ]) {
    const flow = login.begin(); await expect(login.finish(flow.id, assertion(flow.publicKey.challenge, change))).rejects.toThrow();
    await expect(login.finish(flow.id, assertion(flow.publicKey.challenge))).rejects.toThrow();
  }
  const flow = login.begin(); await expect(login.finish(flow.id, assertion('wrong-challenge'))).rejects.toThrow();
});

test('substituted IDs, absent user handles and damaged signatures fail', async () => {
  const { login, assertion } = setup();
  for (const change of ['id', 'rawId', 'handle', 'signature']) {
    const flow = login.begin(), input = assertion(flow.publicKey.challenge);
    if (change === 'id') input.id = 'dW5rbm93bg';
    if (change === 'rawId') input.rawId = 'dW5rbm93bg';
    if (change === 'handle') delete input.response.userHandle;
    if (change === 'signature') { const bytes = Buffer.from(input.response.signature, 'base64url'); bytes[bytes.length - 1]! ^= 1; input.response.signature = bytes.toString('base64url'); }
    await expect(login.finish(flow.id, input)).rejects.toThrow();
  }
});

test('single-attempt challenges cannot replay or complete twice concurrently across connections', async () => {
  const { login, connect, assertion } = setup(); const peer = connect(); const flow = login.begin(), input = assertion(flow.publicKey.challenge);
  const results = await Promise.allSettled([login.finish(flow.id, input), peer.finish(flow.id, input)]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
  await expect(peer.finish(flow.id, input)).rejects.toThrow();
});

test('challenges and counters persist across close/reopen; expired and non-increasing counters fail', async () => {
  const { login, connect, assertion, state } = setup(); const flow = login.begin(); login.close(); const reopened = connect();
  await reopened.finish(flow.id, assertion(flow.publicKey.challenge, { counter: 2 }));
  const stale = reopened.begin(); await expect(reopened.finish(stale.id, assertion(stale.publicKey.challenge, { counter: 2 }))).rejects.toThrow();
  const expired = reopened.begin(); state.at = expired.expiresAt;
  await expect(reopened.finish(expired.id, assertion(expired.publicKey.challenge, { counter: 3 }))).rejects.toThrow();
});

test('counter-zero authenticators still receive single-attempt replay protection', async () => {
  const { login, assertion } = setup();
  for (let i = 0; i < 2; i++) {
    const flow = login.begin(), input = assertion(flow.publicKey.challenge, { counter: 0 });
    expect((await login.finish(flow.id, input)).token).toMatch(/^amr1_/);
    await expect(login.finish(flow.id, input)).rejects.toThrow();
  }
});

test('authority revocation while library verification awaits prevents session issuance', async () => {
  const { login, assertion, authority, credentialID } = setup(); const flow = login.begin();
  const pending = login.finish(flow.id, assertion(flow.publicKey.challenge));
  authority.revokeCredential(credentialID);
  await expect(pending).rejects.toThrow();
  await expect(login.finish(flow.id, assertion(flow.publicKey.challenge))).rejects.toThrow();
});

test('expiry advancing during verification fails and consumed attempts survive authority failure', async () => {
  const { login, assertion, authority, state } = setup(); const flow = login.begin();
  const pending = login.finish(flow.id, assertion(flow.publicKey.challenge)); state.at = flow.expiresAt;
  await expect(pending).rejects.toThrow();
  const next = login.begin(); authority.close();
  await expect(login.finish(next.id, assertion(next.publicKey.challenge, { counter: 2 }))).rejects.toThrow();
  await expect(login.finish(next.id, assertion(next.publicKey.challenge, { counter: 2 }))).rejects.toThrow();
});

test('scope mismatch and credential re-provisioning cannot change login authority', () => {
  const { login, authority, dir, policy, credentialID, cose, userHandle } = setup();
  expect(() => login.provisionVerifiedPasskey(credentialID, cose, 0, userHandle)).toThrow();
  for (const change of [{ rpID: 'foreign.example' }, { origin: 'https://foreign.example', rpID: 'foreign.example' }, { environment: 'foreign' }]) expect(() => openVerifiedLogin(join(dir, 'login.sqlite'), authority, { ...policy, ...change })).toThrow();
});

test('independent concurrent zero-counter challenges cannot overwrite a newer credential revision', async () => {
  const { login, connect, assertion } = setup(); const peer = connect();
  const first = login.begin(), second = peer.begin();
  const results = await Promise.allSettled([login.finish(first.id, assertion(first.publicKey.challenge, { counter: 0 })), peer.finish(second.id, assertion(second.publicKey.challenge, { counter: 0 }))]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
});
