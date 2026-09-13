import { Database } from 'bun:sqlite';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Ownership, Resource, Session } from './gate.ts';

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
export function openMemberAuthority(path: string, options: Options) {
  const { environment, audience, maxSessionLifetimeMs } = options;
  name(environment);
  if (new URL(audience).origin !== audience || !audience.startsWith('https://')) throw new Error('Explicit HTTPS audience required');
  timestamp(maxSessionLifetimeMs);
  if (!maxSessionLifetimeMs) throw new Error('Positive session lifetime required');
  const clock = options.now ?? Date.now;
  const now = () => { const value = clock(); timestamp(value); return value; };
  const db = new Database(path, { create: true, strict: true });
  try {
    db.run('PRAGMA foreign_keys = ON');
    db.run('PRAGMA busy_timeout = 1000');
    db.transaction(() => {
      const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
      if (!tables.length) {
        db.run(`
          CREATE TABLE authority_meta (singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL, environment TEXT NOT NULL, audience TEXT NOT NULL);
          CREATE TABLE principals (id TEXT PRIMARY KEY, household TEXT NOT NULL, presenters TEXT NOT NULL, disabled INTEGER NOT NULL CHECK(disabled IN (0,1)));
          CREATE TABLE credentials (id TEXT PRIMARY KEY, principal TEXT NOT NULL REFERENCES principals(id), revoked INTEGER NOT NULL CHECK(revoked IN (0,1)));
          CREATE TABLE sessions (id TEXT PRIMARY KEY, digest TEXT NOT NULL UNIQUE, credential TEXT NOT NULL REFERENCES credentials(id), expires INTEGER NOT NULL, revoked INTEGER NOT NULL CHECK(revoked IN (0,1)));
          CREATE INDEX sessions_credential ON sessions(credential);
          CREATE TABLE ownership (kind TEXT NOT NULL CHECK(kind IN ('offer','mandate')), id TEXT NOT NULL, household TEXT NOT NULL, presenter TEXT, invalidated INTEGER NOT NULL CHECK(invalidated IN (0,1)), PRIMARY KEY(kind,id), CHECK((kind='offer' AND presenter IS NOT NULL) OR (kind='mandate' AND presenter IS NULL)));
        `);
        db.query('INSERT INTO authority_meta VALUES (1,1,?,?)').run(environment, audience);
      } else {
        if (tables.map(t => t.name).sort().join(',') !== 'authority_meta,credentials,ownership,principals,sessions') throw new Error('Unrecognised authority schema');
        const rows = db.query('SELECT version, environment, audience FROM authority_meta').all() as { version: number; environment: string; audience: string }[];
        if (rows.length !== 1 || rows[0]!.version !== 1 || rows[0]!.environment !== environment || rows[0]!.audience !== audience) throw new Error('Authority schema or scope mismatch');
      }
    }).immediate();
    db.run('PRAGMA journal_mode = WAL');
    db.run('PRAGMA synchronous = FULL');
  } catch (error) { db.close(); throw error; }
  const digest = (token: string) => createHash('sha256').update(JSON.stringify(['atarasy.member-session.1', environment, audience, token])).digest('hex');
  function principal(id: string) {
    return db.query('SELECT household, presenters, disabled FROM principals WHERE id=?').get(id) as { household: string; presenters: string; disabled: number } | null;
  }
  function revokePrincipalSessions(id: string) {
    db.query('UPDATE sessions SET revoked=1 WHERE credential IN (SELECT id FROM credentials WHERE principal=?)').run(id);
  }
  return {
    provisionPrincipal(id: string, household: string, presenters: readonly string[]) {
      name(id); name(household); const encoded = grants(presenters);
      // INSERT only: no rebind, revive or silent overwrite of an existing principal.
      db.query('INSERT INTO principals VALUES (?,?,?,0)').run(id, household, encoded);
    },
    registerCredential(id: string, principalID: string) {
      name(id); name(principalID);
      db.transaction(() => {
        const p = principal(principalID);
        if (!p || p.disabled !== 0) throw new Error('Principal unavailable');
        db.query('INSERT INTO credentials VALUES (?,?,0)').run(id, principalID);
      }).immediate();
    },
    setPresenterGrants(id: string, presenters: readonly string[]) {
      name(id); const encoded = grants(presenters);
      db.transaction(() => {
        const p = principal(id);
        if (!p || p.disabled !== 0) throw new Error('Principal unavailable');
        if (p.presenters === encoded) return;
        db.query('UPDATE principals SET presenters=? WHERE id=?').run(encoded, id);
        revokePrincipalSessions(id);
      }).immediate();
    },
    disablePrincipal(id: string) {
      name(id);
      db.transaction(() => {
        db.query('UPDATE principals SET disabled=1 WHERE id=?').run(id);
        revokePrincipalSessions(id);
      }).immediate();
    },
    revokeCredential(id: string) {
      name(id);
      db.transaction(() => {
        db.query('UPDATE credentials SET revoked=1 WHERE id=?').run(id);
        db.query('UPDATE sessions SET revoked=1 WHERE credential=?').run(id);
      }).immediate();
    },
    createSessionAfterVerification(credentialID: string, expiresAt: number) {
      name(credentialID); timestamp(expiresAt);
      return db.transaction(() => {
        const at = now();
        if (expiresAt <= at || expiresAt - at > maxSessionLifetimeMs) throw new Error('Invalid session expiry');
        const c = db.query('SELECT c.revoked, p.disabled FROM credentials c JOIN principals p ON p.id=c.principal WHERE c.id=?').get(credentialID) as { revoked: number; disabled: number } | null;
        if (!c || c.revoked !== 0 || c.disabled !== 0) throw new Error('Credential unavailable');
        const id = randomUUID(), token = 'amr1_' + randomBytes(32).toString('base64url');
        db.query('INSERT INTO sessions VALUES (?,?,?,?,0)').run(id, digest(token), credentialID, expiresAt);
        return { id, token, expiresAt };
      }).immediate();
    },
    revokeSession(id: string) {
      name(id); db.query('UPDATE sessions SET revoked=1 WHERE id=?').run(id);
    },
    async resolveSession(token: string): Promise<Session | undefined> {
      if (!/^amr1_[A-Za-z0-9_-]{43}$/.test(token)) return;
      const row = db.query(`SELECT s.id, s.expires, p.household, p.presenters FROM sessions s
        JOIN credentials c ON c.id=s.credential JOIN principals p ON p.id=c.principal
        WHERE s.digest=? AND s.revoked=0 AND c.revoked=0 AND p.disabled=0 AND s.expires>?`).get(digest(token), now()) as { id: string; expires: number; household: string; presenters: string } | null;
      if (!row) return;
      const presenters: unknown = JSON.parse(row.presenters);
      if (!Array.isArray(presenters) || grants(presenters) !== row.presenters) throw new Error('Invalid stored grants');
      name(row.household); timestamp(row.expires);
      return { id: row.id, household: row.household, presenters, expiresAt: row.expires, revoked: false, environment };
    },
    bindResource(resource: Resource, owner: Ownership) {
      name(resource.id); name(owner.household);
      if (resource.kind !== 'offer' && resource.kind !== 'mandate') throw new Error('Invalid resource kind');
      if (resource.kind === 'offer') name(owner.presenter);
      else if (owner.presenter !== undefined) throw new Error('Mandate has no presenter binding');
      const presenter = owner.presenter ?? null;
      db.transaction(() => {
        const previous = db.query('SELECT household,presenter,invalidated FROM ownership WHERE kind=? AND id=?').get(resource.kind, resource.id) as { household: string; presenter: string | null; invalidated: number } | null;
        if (previous) {
          if (previous.invalidated !== 0 || previous.household !== owner.household || previous.presenter !== presenter) throw new Error('Immutable resource binding');
          return;
        }
        db.query('INSERT INTO ownership VALUES (?,?,?,?,0)').run(resource.kind, resource.id, owner.household, presenter);
      }).immediate();
    },
    invalidateResource(resource: Resource) {
      name(resource.id);
      // Unknown IDs cannot be provisioned as revoked claims by an unverified caller.
      db.query('UPDATE ownership SET invalidated=1 WHERE kind=? AND id=?').run(resource.kind, resource.id);
    },
    async ownerOf(resource: Resource): Promise<Ownership | undefined> {
      const row = db.query('SELECT household,presenter FROM ownership WHERE kind=? AND id=? AND invalidated=0').get(resource.kind, resource.id) as { household: string; presenter: string | null } | null;
      if (!row) return;
      return row.presenter === null ? { household: row.household } : { household: row.household, presenter: row.presenter };
    },
    close() { db.close(); },
  };
}
