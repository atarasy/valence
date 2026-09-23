import { records, type Records } from './records.ts';
import { createPublicKey, randomBytes, randomUUID } from 'node:crypto';
import { verifyAuthenticationResponse, type AuthenticationResponseJSON } from '@simplewebauthn/server';
import type { openMemberAuthority } from './authority.ts';
import { credentialSPKI } from '../member-login/credential-key.ts';
import { acceptedAssertionOrigins, androidAssertionOrigins } from '../member-login/assertion-origins.ts';

type Authority = ReturnType<typeof openMemberAuthority>;
type Policy = { environment: string; origin: string; rpID: string; androidAppOrigins?: string[]; challengeLifetimeMs: number; sessionLifetimeMs: number; now?: () => number };
export type PreparedAssertion = AuthenticationResponseJSON;
type Credential = { id: string; public_key: number[]; counter: number; user_handle: string; revision: number };
function b64(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096 && /^[A-Za-z0-9_-]+$/.test(value) && Buffer.from(value, 'base64url').toString('base64url') === value;
}
function integer(value: number) { if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid login time or counter'); }
export function openVerifiedLogin(path: Records, authority: Authority, policy: Policy) {
  const { environment, origin, rpID, challengeLifetimeMs, sessionLifetimeMs } = policy;
  const androidOrigins = androidAssertionOrigins(policy.androidAppOrigins ?? []), expectedOrigins = acceptedAssertionOrigins(origin, androidOrigins);
  const url = new URL(origin);
  // OPS-01: the one exception to https is a 'local' environment serving http://127.0.0.1.
  const isLocalLoginOrigin = environment === 'local' && url.protocol === 'http:' && url.hostname === '127.0.0.1';
  if (!environment || url.origin !== origin || (url.protocol !== 'https:' && !isLocalLoginOrigin) || url.hostname !== rpID || authority.scope.environment !== environment || authority.scope.audience !== origin) throw new Error('Explicit matching login scope required');
  for (const duration of [challengeLifetimeMs, sessionLifetimeMs]) { integer(duration); if (!duration) throw new Error('Positive login lifetime required'); }
  const clock = policy.now ?? Date.now;
  const now = () => { const at = clock(); integer(at); return at; };
  const db=path,shared=true,passkeys=records<any>(path,'member_passkeys'),challenges=records<any>(path,'member_challenges');
  path.assert(authority);
  // The authority names a household after a credential's key, and this module is
  // what holds that key, so it hands over the reader once at construction rather
  // than letting a caller pass one per adoption.
  authority.useCredentialKeys((id: string) => {
    if (!b64(id)) return undefined;
    const row = passkeys.get(id);
    if (!row || row.active !== 1) return undefined;
    return createPublicKey({ key: credentialSPKI(new Uint8Array(row.public_key)), format: 'der', type: 'spki' }).export({ type: 'spki', format: 'pem' }).toString();
  });
  function activeKey(id:string){const v=passkeys.get(id);return v?.active===1?v:null;}
  return path.register({
    scope: Object.freeze({ environment, origin, rpID, androidAppOrigins: androidOrigins }),
    /** Only after verified enrollment and authority credential provisioning. No rebind API. */
    provisionVerifiedPasskey(id: string, publicKey: Uint8Array, counter: number, userHandle: string) {
      if (!b64(id) || !b64(userHandle) || !(publicKey instanceof Uint8Array) || !publicKey.length || publicKey.length > 4096) throw new Error('Invalid enrolled credential');
      integer(counter); if (counter > 0xffffffff) throw new Error('Invalid authenticator counter');
      passkeys.insert(id,{id,public_key:Array.from(publicKey),counter,user_handle:userHandle,revision:0,active:1});
    },
    /** Called only with library-verified enrollment data and an invitation-bound principal. */
    enrolVerifiedPasskey(principal: string, id: string, publicKey: Uint8Array, counter: number, userHandle: string) {
      if (!b64(id) || !b64(userHandle) || !(publicKey instanceof Uint8Array) || !publicKey.length || publicKey.length > 4096) throw new Error('Invalid enrolled credential');
      integer(counter); if (counter > 0xffffffff) throw new Error('Invalid authenticator counter');
      // The authority's refusals run before anything is written. The order was
      // the other way and the caller's savepoint was what kept a refused
      // enrolment from leaving a passkey row; a seventh refutation pass on
      // 2026-09-16 named the dependence even though it measured it clean.
      authority.registerCredential(id, principal);
      passkeys.insert(id,{id,public_key:Array.from(publicKey),counter,user_handle:userHandle,revision:0,active:0});
      const changed = passkeys.updateWhere(id,v=>v.active===0,{active:1});
      if (changed.changes !== 1) throw new Error('Enrollment activation failed');
    },
    /**
     * Trusted administration only. Removes an enrolled passkey outright rather
     * than marking it inactive, because a row left behind makes the same device
     * unable to enrol again: `insert` refuses a duplicate id and the user handle
     * persists. Measured by a seventh refutation pass on 2026-09-16, which found
     * the tool telling the operator to enrol again after an operation that made
     * enrolling again impossible.
     */
    removeEnrolledPasskey(id: string) {
      if (!b64(id)) throw new Error('Invalid enrolled credential');
      passkeys.delete(id);
    },
    /** Detached active public-key data for trusted internal mandate binding only. */
    verifiedPublicKey(id: string): Uint8Array | undefined {
      if (!b64(id)) return;
      const row = activeKey(id) as { public_key: number[] } | null;
      return row ? new Uint8Array(row.public_key) : undefined;
    },
    /** Internal prepared-authorisation verifier; must share the outer local transaction. */
    async verifyPreparedAssertion(credentialID: string, challenge: string, response: AuthenticationResponseJSON) {
      if (!shared || !b64(challenge) || challenge.length !== 43 || !b64(credentialID)) throw new Error('Prepared assertion unavailable');
      const fixed = structuredClone(response);
      if (!fixed || JSON.stringify(fixed).length > 16384 || fixed.id !== credentialID || fixed.rawId !== credentialID || fixed.type !== 'public-key' || !fixed.response) throw new Error('Prepared assertion unavailable');
      for (const value of [fixed.response.clientDataJSON, fixed.response.authenticatorData, fixed.response.signature]) if (!b64(value)) throw new Error('Prepared assertion unavailable');
      const client = JSON.parse(Buffer.from(fixed.response.clientDataJSON, 'base64url').toString('utf8'));
      if ((client.crossOrigin !== undefined && client.crossOrigin !== false) || client.topOrigin !== undefined) throw new Error('Cross-origin assertion refused');
      const credential = activeKey(credentialID) as Credential | null;
      if (!credential || (fixed.response.userHandle != null && fixed.response.userHandle !== credential.user_handle)) throw new Error('Prepared assertion unavailable');
      const result = await verifyAuthenticationResponse({ response: fixed, expectedChallenge: challenge, expectedOrigin: expectedOrigins, expectedRPID: rpID, expectedType: 'webauthn.get', requireUserVerification: true,
        credential: { id: credential.id, publicKey: new Uint8Array(credential.public_key), counter: credential.counter } });
      if (!result.verified || !result.authenticationInfo.userVerified || result.authenticationInfo.credentialID !== credentialID) throw new Error('Prepared assertion unavailable');
      const counter = result.authenticationInfo.newCounter; integer(counter);
      if (counter > 0xffffffff) throw new Error('Invalid authenticator counter');
      const updated = passkeys.updateWhere(credentialID,v=>v.revision===credential.revision&&v.active===1,{counter,revision:credential.revision+1});
      if (updated.changes !== 1) throw new Error('Credential changed during verification');
      // This key has now signed something, which registration never established.
      authority.markCredentialProven(credentialID);
      return { counter };
    },
    /** Verify a member-held proof made at the receiving HTTPS origin without changing this host's counter. */
    async verifyPortableAssertion(credentialID: string, challenge: string, response: AuthenticationResponseJSON, receivingOrigin: string) {
      if (!b64(challenge) || challenge.length !== 43 || !b64(credentialID)) throw new Error('Portable assertion unavailable');
      const target = new URL(receivingOrigin);
      if (target.origin !== receivingOrigin || target.protocol !== 'https:' || target.username || target.password || target.pathname !== '/' || target.search || target.hash) throw new Error('Portable assertion unavailable');
      const fixed = structuredClone(response), credential = activeKey(credentialID) as Credential | null;
      if (!credential || !fixed || JSON.stringify(fixed).length > 16384 || fixed.id !== credentialID || fixed.rawId !== credentialID || fixed.type !== 'public-key' || !fixed.response) throw new Error('Portable assertion unavailable');
      for (const value of [fixed.response.clientDataJSON, fixed.response.authenticatorData, fixed.response.signature]) if (!b64(value)) throw new Error('Portable assertion unavailable');
      const client = JSON.parse(Buffer.from(fixed.response.clientDataJSON, 'base64url').toString('utf8'));
      if ((client.crossOrigin !== undefined && client.crossOrigin !== false) || client.topOrigin !== undefined || (fixed.response.userHandle != null && fixed.response.userHandle !== credential.user_handle)) throw new Error('Portable assertion unavailable');
      const result = await verifyAuthenticationResponse({ response: fixed, expectedChallenge: challenge, expectedOrigin: [receivingOrigin, ...androidOrigins], expectedRPID: target.hostname, expectedType: 'webauthn.get', requireUserVerification: true,
        // This proof is bound to one import receipt and may come from a synced
        // passkey whose per-device counter is unrelated to this host's copy.
        credential: { id: credential.id, publicKey: new Uint8Array(credential.public_key), counter: 0 } });
      if (!result.verified || !result.authenticationInfo.userVerified || result.authenticationInfo.credentialID !== credentialID) throw new Error('Portable assertion unavailable');
      return { counter: result.authenticationInfo.newCounter };
    },
    begin() {
      const at = now(), expiresAt = at + challengeLifetimeMs; integer(expiresAt);
      const id = randomUUID(), challenge = randomBytes(32).toString('base64url');
      db.transaction(() => {
        challenges.deleteWhere(v=>v.expires<=at);
        challenges.insert(id,{id,challenge,expires:expiresAt});
      }).immediate();
      return { id, expiresAt, publicKey: { challenge, rpId: rpID, timeout: challengeLifetimeMs, userVerification: 'required' as const, allowCredentials: [] } };
    },
    async finish(id: string, response: AuthenticationResponseJSON) {
      // Consume even a failed verification. A crash or bad assertion requires a new ceremony.
      const flow = db.transaction(() => {
        const row = challenges.get(id) as { challenge: string; expires: number } | null;
        challenges.delete(id);
        return row;
      }).immediate();
      if (!flow || flow.expires <= now()) throw new Error('Login unavailable');
      if (!response || !b64(response.id) || response.rawId !== response.id || !response.response || !b64(response.response.userHandle)) throw new Error('Login unavailable');
      const credential = activeKey(response.id) as Credential | null;
      if (!credential || response.response.userHandle !== credential.user_handle) throw new Error('Login unavailable');
      // A detached snapshot is used throughout the asynchronous cryptographic check.
      const result = await verifyAuthenticationResponse({ response: structuredClone(response), expectedChallenge: flow.challenge, expectedOrigin: expectedOrigins, expectedRPID: rpID, expectedType: 'webauthn.get', requireUserVerification: true,
        credential: { id: credential.id, publicKey: new Uint8Array(credential.public_key), counter: credential.counter } });
      if (!result.verified || !result.authenticationInfo.userVerified || result.authenticationInfo.credentialID !== credential.id || flow.expires <= now()) throw new Error('Login unavailable');
      integer(result.authenticationInfo.newCounter);
      const updated = passkeys.updateWhere(credential.id,v=>v.revision===credential.revision,{counter:result.authenticationInfo.newCounter,revision:credential.revision+1});
      if (updated.changes !== 1) throw new Error('Login changed during verification');
      authority.markCredentialProven(credential.id);
      const expiry = now() + sessionLifetimeMs; integer(expiry);
      // Authoritative lifecycle checks run again here. If issuance fails, the attempt stays spent.
      return authority.createSessionAfterVerification(credential.id, expiry);
    },
    close() { db.close(); },
  });
}
