import { records, type Records } from './records.ts';
import { createHash, createPublicKey } from 'node:crypto';
import type { openMemberAuthority } from './authority.ts';
import type { openVerifiedLogin } from './login.ts';
import type { ValenceEngine } from '../../engine/src/engine/offers.ts';
import { credentialSPKI } from '../member-login/credential-key.ts';

type Authority = ReturnType<typeof openMemberAuthority>;
type Login = ReturnType<typeof openVerifiedLogin>;
type Binding = { mandate: string; principal: string; credential: string; household: string; fingerprint: string };
/** Internal precondition evidence only. Not an assertion verifier or dispatch grant. */
export function openMandateBindings(path: Records, authority: Authority, login: Login, engine: Pick<ValenceEngine, 'publicKeyFor' | 'config'>) {
  const scope = [1, authority.scope.environment, authority.scope.audience, login.scope.rpID];
  if (authority.scope.environment !== login.scope.environment || authority.scope.audience !== login.scope.origin || engine.config.relyingPartyId !== login.scope.rpID) throw new Error('Binding scope mismatch');
  path.assert(authority,login);const db=path,bindings=records<Binding>(path,'member_bindings');
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
  const stored = (mandate: string) => bindings.get(mandate) as Binding | null;
  function matches(a: Binding, b: Binding) { return a.mandate === b.mandate && a.principal === b.principal && a.credential === b.credential && a.household === b.household && a.fingerprint === b.fingerprint; }
  return path.register({
    scope: Object.freeze({ environment: authority.scope.environment, audience: authority.scope.audience, rpID: login.scope.rpID }),
    /** Idempotent only for the exact existing binding. No engine identity write. */
    bind(token: string, mandate: string) {
      return db.transaction(() => {
        const evidence = current(token, mandate), before = stored(mandate);
        if (before && !matches(before, evidence.binding)) throw new Error('Immutable mandate binding');
        if (!before) {
          const b = evidence.binding;
          bindings.insert(b.mandate,b);
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
