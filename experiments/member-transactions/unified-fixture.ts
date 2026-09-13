// Internal test fixture: real login verifier and local engine; trusted transaction proof.
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import type { Store } from '../../engine/src/common/store.ts';
import { canonicalStatement, statementLines } from '../../engine/src/shared/statement.ts';
import { openMemberAuthority } from '../member-read/authority.ts';
import { openVerifiedLogin } from '../member-login/login.ts';
import { openMandateBindings } from './mandate-binding.ts';
import { openOperationJournal, type JournalOperation } from './operation-journal.ts';
import { openAtomicStore } from './atomic-store.ts';
import { databaseFor, type SharedDatabase } from './shared-database.ts';
import { atomicScope, fixtureTime, localRuntime, seedAtomicFixture, type FixtureStatement } from './atomic-fixture.ts';
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export function unifiedRuntime(store: Store, database: SharedDatabase, at = fixtureTime + 1) {
  const runtime = localRuntime(store);
  const authority = openMemberAuthority(database, { ...atomicScope, maxSessionLifetimeMs: 10000, now: () => at });
  const login = openVerifiedLogin(database, authority, { environment: 'test', origin: atomicScope.audience, rpID: 'unit.example', challengeLifetimeMs: 1000, sessionLifetimeMs: 9000, now: () => at });
  const bindings = openMandateBindings(database, authority, login, runtime.engine);
  const journal = openOperationJournal(database, authority, bindings, { maximumLifetimeMs: 5000, now: () => at });
  return { ...runtime, authority, login, bindings, journal };
}
export function loginResponse(pair: ReturnType<typeof generateKeyPairSync>, credential: string, user: string, challenge: string, counter = 1) {
  const digest = (input: string | Buffer) => createHash('sha256').update(input).digest();
  const client = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin: atomicScope.audience }));
  const count = Buffer.alloc(4); count.writeUInt32BE(counter);
  const auth = Buffer.concat([digest('unit.example'), Buffer.from([5]), count]);
  return { id: credential, rawId: credential, type: 'public-key' as const, clientExtensionResults: {}, response: { clientDataJSON: client.toString('base64url'), authenticatorData: auth.toString('base64url'), signature: sign('sha256', Buffer.concat([auth, digest(client)]), pair.privateKey).toString('base64url'), userHandle: user } };
}
export type UnifiedInput = { token: string; credential: string; session: string; statement: FixtureStatement; operation: JournalOperation };
export async function seedUnified(path: string) {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }), jwk = pair.publicKey.export({ format: 'jwk' });
  const [statement] = await seedAtomicFixture(path, 1, null, pair), unit = openAtomicStore(path, atomicScope);
  const credential = randomBytes(32).toString('base64url'), user = randomBytes(32).toString('base64url');
  try {
    const input = await unit.run(async (store, database) => {
      const r = unifiedRuntime(store, database);
      r.authority.provisionPrincipal('member', 'house', ['merchant-1']); r.authority.registerCredential(credential, 'member');
      const cose = Buffer.concat([Buffer.from('a5010203262001215820', 'hex'), Buffer.from(jwk.x!, 'base64url'), Buffer.from('225820', 'hex'), Buffer.from(jwk.y!, 'base64url')]);
      r.login.provisionVerifiedPasskey(credential, cose, 0, user);
      r.authority.bindResource({ kind: 'mandate', id: 'mandate-1' }, { household: 'house' });
      r.authority.bindResource({ kind: 'offer', id: statement!.offer }, { household: 'house', presenter: 'merchant-1' });
      const flow = r.login.begin(), session = await r.login.finish(flow.id, loginResponse(pair, credential, user, flow.publicKey.challenge));
      r.bindings.bind(session.token, 'mandate-1');
      const canonical = canonicalStatement(statement!.offer, 550, statementLines(r.engine.mustGet(statement!.offer), [])).toString();
      const operation = await r.journal.prepare(session.token, { offer: statement!.offer, mandate: 'mandate-1', presenter: 'merchant-1', canonical, reviewedRevision: hash('fixture-reviewed-revision'), expiresAt: fixtureTime + 4000 });
      return { token: session.token, session: session.id, credential, statement: statement!, operation };
    });
    return { input, pair, user };
  } finally { unit.close(); }
}
/** Proof is trusted fixture input. This is not the future member assertion dispatcher. */
export async function commitUnified(store: Store, database: SharedDatabase, input: UnifiedInput, checkpoint: (at: string) => Promise<void> = async () => {}) {
  const r = unifiedRuntime(store, database);
  const fingerprint = hash(input.statement.signature);
  const claim = await r.journal.claimVerified(input.token, input.operation.id, { requestDigest: input.operation.requestDigest, reviewedRevision: input.operation.reviewedRevision, assertionFingerprint: fingerprint });
  if (!claim.acquired) {
    const receipt = r.engine.settlement(input.statement.offer);
    if (claim.operation.state !== 'committed' || !receipt || hash(JSON.stringify(receipt)) !== claim.operation.receiptDigest) throw new Error('Local outcome unresolved');
    return { operation: claim.operation, receipt };
  }
  await checkpoint('claimed');
  const receipt = await r.engine.settle(input.statement.offer, fixtureTime + 1, { signed: { signature: input.statement.signature }, disputed: input.statement.disputed });
  await checkpoint('engine');
  const operation = r.journal.recordCommitted(input.operation.id, fingerprint, hash(JSON.stringify(receipt)));
  await checkpoint('outcome');
  return { operation, receipt };
}
export function inspectUnified(store: Store, database: SharedDatabase, input: UnifiedInput) {
  const r = unifiedRuntime(store, database), db = databaseFor(database, atomicScope).db;
  const operation = db.query('SELECT record FROM operations WHERE id=?').get(input.operation.id) as { record: string };
  return { operation: JSON.parse(operation.record) as JournalOperation, receipt: r.engine.settlement(input.statement.offer) ?? null, reservation: r.ledger.get(input.statement.offer), state: r.engine.mustGet(input.statement.offer).state, day: r.engine.householdLedger.forHousehold('house'), counter: (db.query('SELECT counter FROM passkeys WHERE id=?').get(input.credential) as { counter: number }).counter };
}
