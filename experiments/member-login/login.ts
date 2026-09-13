import { Database } from 'bun:sqlite';
import { randomBytes, randomUUID } from 'node:crypto';
import { verifyAuthenticationResponse, type AuthenticationResponseJSON } from '@simplewebauthn/server';
import type { openMemberAuthority } from '../member-read/authority.ts';

type Authority = ReturnType<typeof openMemberAuthority>;
type Policy = { environment: string; origin: string; rpID: string; challengeLifetimeMs: number; sessionLifetimeMs: number; now?: () => number };
type Credential = { id: string; public_key: Uint8Array; counter: number; user_handle: string; revision: number };
function b64(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096 && /^[A-Za-z0-9_-]+$/.test(value) && Buffer.from(value, 'base64url').toString('base64url') === value;
}
function integer(value: number) { if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid login time or counter'); }
export function openVerifiedLogin(path: string, authority: Authority, policy: Policy) {
  const { environment, origin, rpID, challengeLifetimeMs, sessionLifetimeMs } = policy;
  const url = new URL(origin);
  if (!environment || url.origin !== origin || url.protocol !== 'https:' || url.hostname !== rpID || authority.scope.environment !== environment || authority.scope.audience !== origin) throw new Error('Explicit matching login scope required');
  for (const duration of [challengeLifetimeMs, sessionLifetimeMs]) { integer(duration); if (!duration) throw new Error('Positive login lifetime required'); }
  const clock = policy.now ?? Date.now;
  const now = () => { const at = clock(); integer(at); return at; };
  const db = new Database(path, { create: true, strict: true });
  try {
    db.run('PRAGMA busy_timeout=1000');
    db.transaction(() => {
      const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
      if (!tables.length) {
        db.run(`CREATE TABLE login_meta (scope TEXT NOT NULL);
          CREATE TABLE passkeys (id TEXT PRIMARY KEY, public_key BLOB NOT NULL, counter INTEGER NOT NULL, user_handle TEXT NOT NULL, revision INTEGER NOT NULL);
          CREATE TABLE challenges (id TEXT PRIMARY KEY, challenge TEXT NOT NULL, expires INTEGER NOT NULL);`);
        db.query('INSERT INTO login_meta VALUES (?)').run(JSON.stringify([1, environment, origin, rpID]));
      } else {
        if (tables.map(t => t.name).sort().join(',') !== 'challenges,login_meta,passkeys') throw new Error('Unknown login schema');
        const rows = db.query('SELECT scope FROM login_meta').all() as { scope: string }[];
        if (rows.length !== 1 || rows[0]!.scope !== JSON.stringify([1, environment, origin, rpID])) throw new Error('Login scope mismatch');
      }
    }).immediate();
    db.run('PRAGMA journal_mode=WAL'); db.run('PRAGMA synchronous=FULL');
  } catch (error) { db.close(); throw error; }
  return {
    /** Only after verified enrollment and authority credential provisioning. No rebind API. */
    provisionVerifiedPasskey(id: string, publicKey: Uint8Array, counter: number, userHandle: string) {
      if (!b64(id) || !b64(userHandle) || !(publicKey instanceof Uint8Array) || !publicKey.length || publicKey.length > 4096) throw new Error('Invalid enrolled credential');
      integer(counter); if (counter > 0xffffffff) throw new Error('Invalid authenticator counter');
      db.query('INSERT INTO passkeys VALUES (?,?,?,?,0)').run(id, publicKey, counter, userHandle);
    },
    begin() {
      const at = now(), expiresAt = at + challengeLifetimeMs; integer(expiresAt);
      const id = randomUUID(), challenge = randomBytes(32).toString('base64url');
      db.transaction(() => {
        db.query('DELETE FROM challenges WHERE expires<=?').run(at);
        db.query('INSERT INTO challenges VALUES (?,?,?)').run(id, challenge, expiresAt);
      }).immediate();
      return { id, expiresAt, publicKey: { challenge, rpId: rpID, timeout: challengeLifetimeMs, userVerification: 'required' as const, allowCredentials: [] } };
    },
    async finish(id: string, response: AuthenticationResponseJSON) {
      // Consume even a failed verification. A crash or bad assertion requires a new ceremony.
      const flow = db.transaction(() => {
        const row = db.query('SELECT challenge,expires FROM challenges WHERE id=?').get(id) as { challenge: string; expires: number } | null;
        db.query('DELETE FROM challenges WHERE id=?').run(id);
        return row;
      }).immediate();
      if (!flow || flow.expires <= now()) throw new Error('Login unavailable');
      if (!response || !b64(response.id) || response.rawId !== response.id || !response.response || !b64(response.response.userHandle)) throw new Error('Login unavailable');
      const credential = db.query('SELECT * FROM passkeys WHERE id=?').get(response.id) as Credential | null;
      if (!credential || response.response.userHandle !== credential.user_handle) throw new Error('Login unavailable');
      // A detached snapshot is used throughout the asynchronous cryptographic check.
      const result = await verifyAuthenticationResponse({ response: structuredClone(response), expectedChallenge: flow.challenge, expectedOrigin: origin, expectedRPID: rpID, expectedType: 'webauthn.get', requireUserVerification: true,
        credential: { id: credential.id, publicKey: new Uint8Array(credential.public_key), counter: credential.counter } });
      if (!result.verified || !result.authenticationInfo.userVerified || result.authenticationInfo.credentialID !== credential.id || flow.expires <= now()) throw new Error('Login unavailable');
      integer(result.authenticationInfo.newCounter);
      const updated = db.query('UPDATE passkeys SET counter=?,revision=revision+1 WHERE id=? AND revision=?').run(result.authenticationInfo.newCounter, credential.id, credential.revision);
      if (updated.changes !== 1) throw new Error('Login changed during verification');
      const expiry = now() + sessionLifetimeMs; integer(expiry);
      // Authoritative lifecycle checks run again here. If issuance fails, the attempt stays spent.
      return authority.createSessionAfterVerification(credential.id, expiry);
    },
    close() { db.close(); },
  };
}
