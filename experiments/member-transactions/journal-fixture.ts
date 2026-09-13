// Test-only real stores and independent credential. Never loaded by a member handler.
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openMemberAuthority } from '../member-read/authority.ts';
import { openVerifiedLogin } from '../member-login/login.ts';
import { openMandateBindings } from './mandate-binding.ts';
import { openOperationJournal, type StatementTerms } from './operation-journal.ts';
import { makeEngine } from '../../engine/test/helpers.ts';
export function connectJournalFixture(dir: string, clock = { at: 1000 }) {
  const authority = openMemberAuthority(join(dir, 'authority.sqlite'), { environment: 'test', audience: 'https://unit.example', maxSessionLifetimeMs: 10000, now: () => clock.at });
  const login = openVerifiedLogin(join(dir, 'login.sqlite'), authority, { environment: 'test', origin: 'https://unit.example', rpID: 'unit.example', challengeLifetimeMs: 1000, sessionLifetimeMs: 9000, now: () => clock.at });
  const { engine } = makeEngine(); engine.registerIdentity('journal-mandate', readFileSync(join(dir, 'public.pem'), 'utf8'));
  const bindings = openMandateBindings(join(dir, 'binding.sqlite'), authority, login, engine);
  const journal = openOperationJournal(join(dir, 'journal.sqlite'), authority, bindings, { maximumLifetimeMs: 5000, now: () => clock.at });
  return { authority, login, bindings, journal, clock, close() { journal.close(); bindings.close(); login.close(); authority.close(); } };
}
export async function seedJournalFixture(dir: string) {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }), jwk = pair.publicKey.export({ format: 'jwk' });
  writeFileSync(join(dir, 'public.pem'), pair.publicKey.export({ type: 'spki', format: 'pem' }));
  const fixture = connectJournalFixture(dir), credential = randomBytes(32).toString('base64url'), user = randomBytes(32).toString('base64url');
  fixture.authority.provisionPrincipal('member', 'house', ['merchant-1']); fixture.authority.registerCredential(credential, 'member');
  const cose = Buffer.concat([Buffer.from('a5010203262001215820', 'hex'), Buffer.from(jwk.x!, 'base64url'), Buffer.from('225820', 'hex'), Buffer.from(jwk.y!, 'base64url')]);
  fixture.login.provisionVerifiedPasskey(credential, cose, 0, user);
  fixture.authority.bindResource({ kind: 'mandate', id: 'journal-mandate' }, { household: 'house' });
  fixture.authority.bindResource({ kind: 'offer', id: 'journal-offer' }, { household: 'house', presenter: 'merchant-1' });
  const flow = fixture.login.begin(), hash = (data: string | Buffer) => createHash('sha256').update(data).digest();
  const client = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: flow.publicKey.challenge, origin: 'https://unit.example' }));
  const auth = Buffer.concat([hash('unit.example'), Buffer.from([5,0,0,0,1])]);
  const signature = sign('sha256', Buffer.concat([auth, hash(client)]), pair.privateKey);
  const session = await fixture.login.finish(flow.id, { id: credential, rawId: credential, type: 'public-key', clientExtensionResults: {}, response: { clientDataJSON: client.toString('base64url'), authenticatorData: auth.toString('base64url'), signature: signature.toString('base64url'), userHandle: user } });
  fixture.bindings.bind(session.token, 'journal-mandate');
  const terms: StatementTerms = { offer: 'journal-offer', mandate: 'journal-mandate', presenter: 'merchant-1', canonical: 'valence.statement.1\njournal-offer\n550\ncandidate:consumed:1200:', reviewedRevision: 'a'.repeat(64), expiresAt: 4000 };
  return { ...fixture, dir, credential, session, terms };
}
