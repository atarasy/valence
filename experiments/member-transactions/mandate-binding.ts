import { databaseFor, registerParticipant, assertParticipants, type DatabaseTarget } from './shared-database.ts';
import { createHash, createPublicKey } from 'node:crypto';
import type { openMemberAuthority } from '../member-read/authority.ts';
import type { openVerifiedLogin } from '../member-login/login.ts';
import type { ValenceEngine } from '../../engine/src/engine/offers.ts';
import { credentialSPKI } from '../member-login/credential-key.ts';

type Authority = ReturnType<typeof openMemberAuthority>;
type Login = ReturnType<typeof openVerifiedLogin>;
type Binding = { mandate: string; principal: string; credential: string; household: string; fingerprint: string };
/** Internal precondition evidence only. Not an assertion verifier or dispatch grant. */
export function openMandateBindings(path: DatabaseTarget, authority: Authority, login: Login, engine: Pick<ValenceEngine, 'publicKeyFor' | 'config'>) {
  const scope = [1, authority.scope.environment, authority.scope.audience, login.scope.rpID];
  if (authority.scope.environment !== login.scope.environment || authority.scope.audience !== login.scope.origin || engine.config.relyingPartyId !== login.scope.rpID) throw new Error('Binding scope mismatch');
  assertParticipants(path, authority, login);
  const { db, shared } = databaseFor(path, authority.scope);
  try {
    if (!shared) db.run('PRAGMA busy_timeout=1000');
    db.transaction(() => {
      let tables = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
      if (shared) tables = tables.filter(t => 'binding_meta,bindings'.split(',').includes(t.name));
      if (!tables.length) {
        db.run('CREATE TABLE binding_meta(scope TEXT NOT NULL); CREATE TABLE bindings(mandate TEXT PRIMARY KEY, principal TEXT NOT NULL, credential TEXT NOT NULL, household TEXT NOT NULL, fingerprint TEXT NOT NULL);');
        db.query('INSERT INTO binding_meta VALUES (?)').run(JSON.stringify(scope));
      } else {
        if (tables.map(t => t.name).sort().join(',') !== 'binding_meta,bindings') throw new Error('Unknown binding schema');
        const rows = db.query('SELECT scope FROM binding_meta').all() as { scope: string }[];
        if (rows.length !== 1 || rows[0]!.scope !== JSON.stringify(scope)) throw new Error('Binding scope mismatch');
      }
    }).immediate();
    if (!shared) db.run('PRAGMA journal_mode=WAL'); if (!shared) db.run('PRAGMA synchronous=FULL');
  } catch (error) { db.close(); throw error; }
  function current(token: string, mandate: string) {
    if (engine.config.relyingPartyId !== login.scope.rpID) throw new Error('Binding scope mismatch');
    const context = authority.transactionContext(token, mandate);
    if (!context) throw new Error('Mandate binding unavailable');
    const credential = login.verifiedPublicKey(context.credential), registered = engine.publicKeyFor(mandate);
    if (!credential || !registered) throw new Error('Mandate binding unavailable');
    const loginKey = credentialSPKI(credential), engineKey = createPublicKey(registered).export({ type: 'spki', format: 'der' });
    if (!loginKey.equals(engineKey)) throw new Error('Mandate key mismatch');
    const binding: Binding = { mandate, principal: context.principal, credential: context.credential, household: context.household, fingerprint: createHash('sha256').update(loginKey).digest('hex') };
    return { binding, session: context.session, expiresAt: context.expiresAt, presenters: context.presenters };
  }
  const stored = (mandate: string) => db.query('SELECT * FROM bindings WHERE mandate=?').get(mandate) as Binding | null;
  function matches(a: Binding, b: Binding) { return a.mandate === b.mandate && a.principal === b.principal && a.credential === b.credential && a.household === b.household && a.fingerprint === b.fingerprint; }
  return registerParticipant(path, {
    scope: Object.freeze({ environment: authority.scope.environment, audience: authority.scope.audience, rpID: login.scope.rpID }),
    /** Idempotent only for the exact existing binding. No engine identity write. */
    bind(token: string, mandate: string) {
      return db.transaction(() => {
        const evidence = current(token, mandate), before = stored(mandate);
        if (before && !matches(before, evidence.binding)) throw new Error('Immutable mandate binding');
        if (!before) {
          const b = evidence.binding;
          db.query('INSERT INTO bindings VALUES (?,?,?,?,?)').run(b.mandate, b.principal, b.credential, b.household, b.fingerprint);
        }
        return evidence;
      }).immediate();
    },
    resolve(token: string, mandate: string) {
      const evidence = current(token, mandate), before = stored(mandate);
      if (!before || !matches(before, evidence.binding)) throw new Error('Mandate binding unavailable');
      return evidence;
    },
    close() { db.close(); },
  });
}
