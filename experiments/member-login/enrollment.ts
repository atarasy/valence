import { assertParticipants, databaseFor, registerParticipant, type DatabaseTarget } from '../member-transactions/shared-database.ts';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { generateRegistrationOptions, verifyRegistrationResponse, type RegistrationResponseJSON } from '@simplewebauthn/server';
import type { openMemberAuthority } from '../member-read/authority.ts';
import type { openVerifiedLogin } from './login.ts';
type Policy = { environment: string; origin: string; rpID: string; rpName: string; invitationLifetimeMs: number; challengeLifetimeMs: number; now?: () => number };
function integer(n: number) { if (!Number.isSafeInteger(n) || n < 0) throw new Error('Invalid enrollment time'); }
export function openEnrollment(path: DatabaseTarget, authority: ReturnType<typeof openMemberAuthority>, login: ReturnType<typeof openVerifiedLogin>, policy: Policy) {
  const { environment, origin, rpID, rpName, invitationLifetimeMs, challengeLifetimeMs } = policy;
  if (environment !== authority.scope.environment || origin !== authority.scope.audience || environment !== login.scope.environment || origin !== login.scope.origin || rpID !== login.scope.rpID || !rpName) throw new Error('Enrollment scope mismatch');
  for (const lifetime of [invitationLifetimeMs, challengeLifetimeMs]) { integer(lifetime); if (!lifetime) throw new Error('Positive enrollment lifetime required'); }
  const clock = policy.now ?? Date.now, now = () => { const at = clock(); integer(at); return at; };
  const scope = JSON.stringify([1, environment, origin, rpID]);
  assertParticipants(path, authority, login);
  const { db, shared } = databaseFor(path, { environment, audience: origin });
  try {
    if (!shared) db.run('PRAGMA busy_timeout=1000');
    db.transaction(() => {
      let tables = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
      if (shared) tables = tables.filter(t => ['enrollment_meta','handles','invitations','flows'].includes(t.name));
      if (!tables.length) {
        db.run(`CREATE TABLE enrollment_meta (scope TEXT NOT NULL);
          CREATE TABLE handles (principal TEXT PRIMARY KEY, handle TEXT NOT NULL UNIQUE);
          CREATE TABLE invitations (digest TEXT PRIMARY KEY, principal TEXT NOT NULL, expires INTEGER NOT NULL);
          CREATE TABLE flows (id TEXT PRIMARY KEY, principal TEXT NOT NULL, handle TEXT NOT NULL, challenge TEXT NOT NULL, expires INTEGER NOT NULL);`);
        db.query('INSERT INTO enrollment_meta VALUES (?)').run(scope);
      } else {
        if (tables.map(t => t.name).sort().join(',') !== 'enrollment_meta,flows,handles,invitations') throw new Error('Unknown enrollment schema');
        const rows = db.query('SELECT scope FROM enrollment_meta').all() as { scope: string }[];
        if (rows.length !== 1 || rows[0]!.scope !== scope) throw new Error('Enrollment scope mismatch');
      }
    }).immediate();
    if (!shared) { db.run('PRAGMA journal_mode=WAL'); db.run('PRAGMA synchronous=FULL'); }
  } catch (error) { db.close(); throw error; }
  const digest = (token: string) => createHash('sha256').update(JSON.stringify(['atarasy.enrollment.1', scope, token])).digest('hex');
  return registerParticipant(path, {
    /** Trusted administration only. The bearer invitation selects the principal. */
    issueInvitation(principal: string) {
      if (!authority.isActivePrincipal(principal)) throw new Error('Principal unavailable');
      const at = now(), expiresAt = at + invitationLifetimeMs; integer(expiresAt);
      const token = 'aen1_' + randomBytes(32).toString('base64url');
      db.transaction(() => {
        db.query('DELETE FROM invitations WHERE expires<=?').run(at);
        db.query('INSERT INTO invitations VALUES (?,?,?)').run(digest(token), principal, expiresAt);
      }).immediate();
      return { token, expiresAt };
    },
    async begin(token: string) {
      if (!/^aen1_[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('Enrollment unavailable');
      const flow = db.transaction(() => {
        const invitation = db.query('SELECT principal,expires FROM invitations WHERE digest=?').get(digest(token)) as { principal: string; expires: number } | null;
        db.query('DELETE FROM invitations WHERE digest=?').run(digest(token));
        const at = now();
        // Return refusal instead of throwing here, so consumption is committed.
        if (!invitation || invitation.expires <= at) return;
        db.query('INSERT OR IGNORE INTO handles VALUES (?,?)').run(invitation.principal, randomBytes(32).toString('base64url'));
        const { handle } = db.query('SELECT handle FROM handles WHERE principal=?').get(invitation.principal) as { handle: string };
        const id = randomUUID(), challenge = randomBytes(32).toString('base64url');
        const expiresAt = Math.min(invitation.expires, at + challengeLifetimeMs); integer(expiresAt);
        db.query('DELETE FROM flows WHERE expires<=?').run(at);
        db.query('INSERT INTO flows VALUES (?,?,?,?,?)').run(id, invitation.principal, handle, challenge, expiresAt);
        return { id, principal: invitation.principal, handle, challenge, expiresAt };
      }).immediate();
      if (!flow || !authority.isActivePrincipal(flow.principal)) throw new Error('Enrollment unavailable');
      const publicKey = await generateRegistrationOptions({ rpName, rpID, userName: 'member-' + flow.handle.slice(-8), userID: new Uint8Array(Buffer.from(flow.handle, 'base64url')), challenge: new Uint8Array(Buffer.from(flow.challenge, 'base64url')), timeout: challengeLifetimeMs,
        attestationType: 'none', supportedAlgorithmIDs: [-7], authenticatorSelection: { residentKey: 'required', userVerification: 'required' } });
      if (flow.expiresAt <= now() || !authority.isActivePrincipal(flow.principal)) { db.query('DELETE FROM flows WHERE id=?').run(flow.id); throw new Error('Enrollment unavailable'); }
      return { id: flow.id, expiresAt: flow.expiresAt, publicKey };
    },
    async finish(id: string, response: RegistrationResponseJSON) {
      const flow = db.transaction(() => {
        const row = db.query('SELECT principal,handle,challenge,expires FROM flows WHERE id=?').get(id) as { principal: string; handle: string; challenge: string; expires: number } | null;
        db.query('DELETE FROM flows WHERE id=?').run(id); return row;
      }).immediate();
      if (!flow || flow.expires <= now() || !authority.isActivePrincipal(flow.principal)) throw new Error('Enrollment unavailable');
      const input = structuredClone(response);
      const verified = await verifyRegistrationResponse({ response: input, expectedChallenge: flow.challenge, expectedOrigin: origin, expectedRPID: rpID, expectedType: 'webauthn.create', requireUserPresence: true, requireUserVerification: true, supportedAlgorithmIDs: [-7] });
      if (!verified.verified || !verified.registrationInfo.userVerified || flow.expires <= now() || !authority.isActivePrincipal(flow.principal)) throw new Error('Enrollment unavailable');
      const credential = verified.registrationInfo.credential;
      if (credential.id !== input.id || input.rawId !== input.id) throw new Error('Enrollment unavailable');
      const activate = () => login.enrolVerifiedPasskey(flow.principal, credential.id, credential.publicKey, credential.counter, flow.handle);
      if (shared) db.transaction(activate).immediate(); else activate();
      return { registered: true as const };
    },
    close() { db.close(); },
  });
}
