import { records, type Records } from './records.ts';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Ownership, Resource, Session } from '../member-read/gate.ts';
import { isHouseholdName, nameOf } from '../../engine/src/common/names.ts';

type Options = { environment: string; audience: string; maxSessionLifetimeMs: number; now?: () => number };
function name(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value || value.length > 1024 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Invalid authority identifier');
}
function timestamp(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid authority time');
}
function grants(values: readonly string[]): string {
  if (!Array.isArray(values)) throw new Error('Invalid presenter grants');
  values.forEach(name);
  return JSON.stringify([...new Set(values)].sort());
}
/** Trusted local capabilities only. None of these methods is a login verifier. */
export function openMemberAuthority(path: Records, options: Options) {
  const { environment, audience, maxSessionLifetimeMs } = options;
  name(environment);
  if (new URL(audience).origin !== audience || !audience.startsWith('https://')) throw new Error('Explicit HTTPS audience required');
  timestamp(maxSessionLifetimeMs);
  if (!maxSessionLifetimeMs) throw new Error('Positive session lifetime required');
  const clock = options.now ?? Date.now;
  const now = () => { const value = clock(); timestamp(value); return value; };
  const db=path, principals=records<any>(path,'member_principals'), credentials=records<any>(path,'member_credentials'), sessions=records<any>(path,'member_sessions'), ownership=records<any>(path,'member_ownership');
  if(path.scope.environment!==environment||path.scope.audience!==audience)throw new Error('Authority scope mismatch');
  const digest = (token: string) => createHash('sha256').update(JSON.stringify(['atarasy.member-session.1', environment, audience, token])).digest('hex');
  function credentialState(id:string){const c=credentials.get(id),p=c&&principals.get(c.principal);return c&&p?{revoked:c.revoked,disabled:p.disabled}:null;}
  function owner(kind:string,id:string){const row=ownership.get(JSON.stringify([kind,id]));return row?.invalidated===0?row:null;}
  function activeSession(digest:string,at:number){const s=sessions.find(v=>v.digest===digest);if(!s||s.revoked!==0||s.expires<=at)return null;const c=credentials.get(s.credential),p=c&&principals.get(c.principal);if(!c||c.revoked!==0||!p||p.disabled!==0)return null;return {id:s.id,expires:s.expires,household:p.household,presenters:p.presenters,credential:c.id,principal:p.id};}
  function context(digest:string,at:number,mandate:string){const s=activeSession(digest,at),o=owner('mandate',mandate);return s&&o&&s.household===o.household?{...s,session:s.id}:null;}
  function principal(id: string) {
    return principals.get(id) as { household: string; presenters: string; disabled: number } | null;
  }
  function revokePrincipalSessions(id: string) {
    sessions.each(s=>{if(credentials.get(s.credential)?.principal===id)sessions.put(s.id,{...s,revoked:1});});
  }
  return path.register({
    scope: Object.freeze({ environment, audience }),
    isActivePrincipal(id: string) { name(id); return principal(id)?.disabled === 0; },
    matchesActivePrincipalScope(id: string, household: string | null, presenters: readonly string[]) {
      name(id); if (household !== null) name(household); const encoded=grants(presenters), p=principal(id);
      return p?.disabled===0 && p.household===household && p.presenters===encoded;
    },
    provisionPrincipal(id: string, household: string, presenters: readonly string[]) {
      name(id); name(household); const encoded = grants(presenters);
      // §13.2, question 55. A household that is the name of a key is adopted by
      // proving that key, never assigned. Without this the column is a free,
      // global, permanent claim on a key's name that proves nothing about the
      // key, which is the registry question 55 was decided to abolish.
      if (isHouseholdName(household)) throw new Error('A household that is a key is adopted, not assigned');
      // INSERT only: no rebind, revive or silent overwrite of an existing principal.
      principals.insert(id,{id,household,presenters:encoded,disabled:0});
    },
    /**
     * §13.2, question 55. A household's identifier is the name of the key its
     * statements are signed with, and on this service that key is the device's
     * own passkey, which does not exist until the device enrols. So a principal
     * invited before enrolment is provisioned without a household and adopts one
     * afterwards. The transition runs once, from unclaimed to a key, and there
     * is no route back: a principal that has a household keeps it.
     */
    provisionUnclaimedPrincipal(id: string, presenters: readonly string[]) {
      name(id); const encoded = grants(presenters);
      principals.insert(id,{id,household:null,presenters:encoded,disabled:0});
    },
    /**
     * §13.2, question 55. The household is **derived from the key the principal
     * holds**, never taken from the caller: `keyOf` reads the public half of
     * that principal's own active credential, exactly as `Mandates.record`
     * takes a `keyOf` rather than a name. A first version took the name as an
     * argument and checked only its shape, and a refutation pass adopted a
     * freshly generated key's name onto a principal with no credential at all.
     *
     * There is deliberately **no uniqueness check**. A second version refused a
     * household any principal held, and a second pass measured what that
     * bought: a row planted by `provisionPrincipal`, which proves nothing about
     * any key, claimed a key's name permanently and locked its real holder out,
     * with no route back. That is the same `409 identity_exists` question 55
     * removed. Two principals can reach one household only by proving one key,
     * and two holders of one key are that key.
     */
    adoptHousehold(id: string, credentialID: string, keyOf: (credential: string) => string | undefined) {
      name(id); name(credentialID);
      return db.transaction(() => {
        const c = credentials.get(credentialID) as { principal: string; revoked: number } | null;
        const p = principal(id);
        if (!c || c.revoked !== 0 || c.principal !== id || !p || p.disabled !== 0) throw new Error('Credential is not this principal\'s');
        const pem = keyOf(credentialID);
        if (!pem) throw new Error('Credential key unavailable');
        const household = nameOf(pem);
        const changed = principals.updateWhere(id, v => v.household === null && v.disabled === 0, { household });
        if (!changed.changes) throw new Error('Principal has a household or is unavailable');
        return household;
      }).immediate();
    },
    registerCredential(id: string, principalID: string) {
      name(id); name(principalID);
      db.transaction(() => {
        const p = principal(principalID);
        if (!p || p.disabled !== 0) throw new Error('Principal unavailable');
        credentials.insert(id,{id,principal:principalID,revoked:0});
      }).immediate();
    },
    /** Trusted operator lookup only. Never exposed by the member HTTP handler. */
    activeCredentialIDs(principalID: string): string[] {
      name(principalID); const ids: string[] = [];
      credentials.each(c => { if (c.principal === principalID && c.revoked === 0) ids.push(c.id); });
      return ids.sort();
    },
    setPresenterGrants(id: string, presenters: readonly string[]) {
      name(id); const encoded = grants(presenters);
      db.transaction(() => {
        const p = principal(id);
        if (!p || p.disabled !== 0) throw new Error('Principal unavailable');
        if (p.presenters === encoded) return;
        principals.patch(id,{presenters:encoded});
        revokePrincipalSessions(id);
      }).immediate();
    },
    disablePrincipal(id: string) {
      name(id);
      db.transaction(() => {
        principals.patch(id,{disabled:1});
        revokePrincipalSessions(id);
      }).immediate();
    },
    revokeCredential(id: string) {
      name(id);
      db.transaction(() => {
        credentials.patch(id,{revoked:1});
        sessions.each(s=>{if(s.credential===id)sessions.patch(s.id,{revoked:1});});
      }).immediate();
    },
    createSessionAfterVerification(credentialID: string, expiresAt: number) {
      name(credentialID); timestamp(expiresAt);
      return db.transaction(() => {
        const at = now();
        if (expiresAt <= at || expiresAt - at > maxSessionLifetimeMs) throw new Error('Invalid session expiry');
        const c = credentialState(credentialID) as { revoked: number; disabled: number } | null;
        if (!c || c.revoked !== 0 || c.disabled !== 0) throw new Error('Credential unavailable');
        const id = randomUUID(), token = 'amr1_' + randomBytes(32).toString('base64url');
        sessions.insert(id,{id,digest:digest(token),credential:credentialID,expires:expiresAt,revoked:0});
        return { id, token, expiresAt };
      }).immediate();
    },
    revokeSession(id: string) {
      name(id); sessions.patch(id,{revoked:1});
    },
    /**
     * Ending a session must not depend on reading it. `resolveSession` answers
     * nothing for a principal that has not adopted a household (§13.2, question
     * 55), and a logout that revoked only what it could resolve answered 204
     * and left that session live for its full hour. Measured by a refutation
     * pass on 2026-09-16.
     */
    endSession(token: string): boolean {
      if (!/^amr1_[A-Za-z0-9_-]{43}$/.test(token)) return false;
      const d=digest(token);
      return db.transaction(() => {
        const row = sessions.find(v=>v.digest===d&&v.revoked===0);
        if (!row) return false;
        sessions.patch(row.id,{revoked:1});
        return true;
      }).immediate();
    },
    async resolveSession(token: string): Promise<Session | undefined> {
      if (!/^amr1_[A-Za-z0-9_-]{43}$/.test(token)) return;
      const row = activeSession(digest(token),now()) as { id: string; expires: number; household: string | null; presenters: string } | null;
      // A principal that has not adopted a household has no session to resolve.
      // Returning rather than throwing is what lets the holder log out: the
      // transport swallows a throw, so the revoke never ran and the session
      // stayed live for its full hour. Measured by a refutation pass 2026-09-16.
      if (!row || row.household === null) return;
      const presenters: unknown = JSON.parse(row.presenters);
      if (!Array.isArray(presenters) || grants(presenters) !== row.presenters) throw new Error('Invalid stored grants');
      name(row.household); timestamp(row.expires);
      return { id: row.id, household: row.household, presenters, expiresAt: row.expires, revoked: false, environment };
    },
    /** Trusted internal lookup only. Never exposed by the member HTTP handler. */
    transactionContext(token: string, mandate: string) {
      if (!/^amr1_[A-Za-z0-9_-]{43}$/.test(token)) return;
      name(mandate);
      const row = context(digest(token),now(),mandate) as { session: string; expires: number; credential: string; principal: string; household: string; presenters: string } | null;
      if (!row) return;
      const presenters: unknown = JSON.parse(row.presenters);
      if (!Array.isArray(presenters) || grants(presenters) !== row.presenters) throw new Error('Invalid stored grants');
      timestamp(row.expires);
      return { session: row.session, expiresAt: row.expires, credential: row.credential, principal: row.principal, household: row.household, presenters: [...presenters] as string[] };
    },
    /** Synchronous detached ownership snapshot for the internal journal. */
    transactionOfferOwner(id: string) {
      name(id);
      const row = owner('offer',id) as { household: string; presenter: string } | null;
      return row ? { household: row.household, presenter: row.presenter } : undefined;
    },
    bindResource(resource: Resource, owner: Ownership) {
      name(resource.id); name(owner.household);
      if (resource.kind !== 'offer' && resource.kind !== 'mandate') throw new Error('Invalid resource kind');
      if (resource.kind === 'offer') name(owner.presenter);
      else if (owner.presenter !== undefined) throw new Error('Mandate has no presenter binding');
      const presenter = owner.presenter ?? null;
      db.transaction(() => {
        const previous = ownership.get(JSON.stringify([resource.kind,resource.id])) as { household: string; presenter: string | null; invalidated: number } | null;
        if (previous) {
          if (previous.invalidated !== 0 || previous.household !== owner.household || previous.presenter !== presenter) throw new Error('Immutable resource binding');
          return;
        }
        ownership.insert(JSON.stringify([resource.kind,resource.id]),{kind:resource.kind,id:resource.id,household:owner.household,presenter,invalidated:0});
      }).immediate();
    },
    invalidateResource(resource: Resource) {
      name(resource.id);
      // Unknown IDs cannot be provisioned as revoked claims by an unverified caller.
      ownership.patch(JSON.stringify([resource.kind,resource.id]),{invalidated:1});
    },
    async ownerOf(resource: Resource): Promise<Ownership | undefined> {
      const row = owner(resource.kind,resource.id) as { household: string; presenter: string | null } | null;
      if (!row) return;
      return row.presenter === null ? { household: row.household } : { household: row.household, presenter: row.presenter };
    },
    close() { db.close(); },
  });
}
