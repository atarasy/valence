import { records, type Records } from './records.ts';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { generateRegistrationOptions, verifyRegistrationResponse, type RegistrationResponseJSON } from '@simplewebauthn/server';
import type { openMemberAuthority } from './authority.ts';
import type { openVerifiedLogin } from './login.ts';
type Policy = { environment: string; origin: string; rpID: string; rpName: string; invitationLifetimeMs: number; challengeLifetimeMs: number; now?: () => number };
function integer(n: number) { if (!Number.isSafeInteger(n) || n < 0) throw new Error('Invalid enrollment time'); }
export function openEnrollment(path: Records, authority: ReturnType<typeof openMemberAuthority>, login: ReturnType<typeof openVerifiedLogin>, policy: Policy) {
  const { environment, origin, rpID, rpName, invitationLifetimeMs, challengeLifetimeMs } = policy;
  if (environment !== authority.scope.environment || origin !== authority.scope.audience || environment !== login.scope.environment || origin !== login.scope.origin || rpID !== login.scope.rpID || !rpName) throw new Error('Enrollment scope mismatch');
  for (const lifetime of [invitationLifetimeMs, challengeLifetimeMs]) { integer(lifetime); if (!lifetime) throw new Error('Positive enrollment lifetime required'); }
  const clock = policy.now ?? Date.now, now = () => { const at = clock(); integer(at); return at; };
  const scope = JSON.stringify([1, environment, origin, rpID]);
  path.assert(authority,login);
  const db=path,shared=true,handles=records<any>(path,'member_handles'),invitations=records<any>(path,'member_invitations'),flows=records<any>(path,'member_flows');
  const digest = (token: string) => createHash('sha256').update(JSON.stringify(['atarasy.enrollment.1', scope, token])).digest('hex');
  return path.register({
    /** Trusted administration only. The bearer invitation selects the principal. */
    issueInvitation(principal: string) {
      if (!authority.isActivePrincipal(principal)) throw new Error('Principal unavailable');
      const at = now(), expiresAt = at + invitationLifetimeMs; integer(expiresAt);
      const token = 'aen1_' + randomBytes(32).toString('base64url');
      db.transaction(() => {
        invitations.deleteWhere(v=>v.expires<=at);
        invitations.insert(digest(token),{principal,expires:expiresAt});
      }).immediate();
      return { token, expiresAt };
    },
    async begin(token: string) {
      if (!/^aen1_[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('Enrollment unavailable');
      const flow = db.transaction(() => {
        const invitation = invitations.get(digest(token)) as { principal: string; expires: number } | null;
        invitations.delete(digest(token));
        const at = now();
        // Return refusal instead of throwing here, so consumption is committed.
        if (!invitation || invitation.expires <= at) return;
        handles.insertIfAbsent(invitation.principal,{handle:randomBytes(32).toString('base64url')});
        const { handle } = handles.get(invitation.principal) as { handle: string };
        const id = randomUUID(), challenge = randomBytes(32).toString('base64url');
        const expiresAt = Math.min(invitation.expires, at + challengeLifetimeMs); integer(expiresAt);
        flows.deleteWhere(v=>v.expires<=at);
        flows.insert(id,{id,principal:invitation.principal,handle,challenge,expires:expiresAt});
        return { id, principal: invitation.principal, handle, challenge, expiresAt };
      }).immediate();
      if (!flow || !authority.isActivePrincipal(flow.principal)) throw new Error('Enrollment unavailable');
      const publicKey = await generateRegistrationOptions({ rpName, rpID, userName: 'member-' + flow.handle.slice(-8), userID: new Uint8Array(Buffer.from(flow.handle, 'base64url')), challenge: new Uint8Array(Buffer.from(flow.challenge, 'base64url')), timeout: challengeLifetimeMs,
        attestationType: 'none', supportedAlgorithmIDs: [-7], authenticatorSelection: { residentKey: 'required', userVerification: 'required' } });
      if (flow.expiresAt <= now() || !authority.isActivePrincipal(flow.principal)) { flows.delete(flow.id); throw new Error('Enrollment unavailable'); }
      return { id: flow.id, expiresAt: flow.expiresAt, publicKey };
    },
    async finish(id: string, response: RegistrationResponseJSON) {
      const flow = db.transaction(() => {
        const row = flows.get(id) as { principal: string; handle: string; challenge: string; expires: number } | null;
        flows.delete(id); return row;
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
