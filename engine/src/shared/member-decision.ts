import { createHash, createPublicKey } from 'node:crypto';
import { verifyAssertion, type Assertion } from './decisions.js';
import { acceptsAssertionOrigin } from './assertion-origins.js';

export const MEMBER_DECISION_PROFILE = 'atarasy.member-decision-authorisation.1';
export type MemberDecisionEnvelope = {
  profile: typeof MEMBER_DECISION_PROFILE; environment: string; origin: string; rpID: string;
  id: string; principal: string; credential: string; household: string; keyFingerprint: string;
  offer: string; mandate: string; presenter: string; canonical: string; reviewedRevision: string;
  expiresAt: number; requestDigest: string;
};
export type MemberDecisionScope = { environment: string; origin: string; androidAppOrigins: readonly string[] };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export function memberDecisionBytes(e: MemberDecisionEnvelope): Buffer {
  return Buffer.from(JSON.stringify([e.profile, JSON.stringify([1, e.environment, e.origin, e.rpID]), e.id, e.requestDigest, e.reviewedRevision]));
}
/** Appendix A: verify the complete signed envelope, never an arbitrary challenge. */
export function verifyMemberDecision(e: MemberDecisionEnvelope, assertion: Assertion, key: string,
  scope: MemberDecisionScope | undefined, rpID: string, canonical: string,
  offer: { id: string; mandate: string; household: string; presenter: string }, now: number): boolean {
  try {
    if (!scope || Object.keys(e).sort().join(',') !== 'canonical,credential,environment,expiresAt,household,id,keyFingerprint,mandate,offer,origin,presenter,principal,profile,requestDigest,reviewedRevision,rpID') return false;
    if (e.profile !== MEMBER_DECISION_PROFILE || e.environment !== scope.environment || e.origin !== scope.origin || e.rpID !== rpID) return false;
    const origin = new URL(scope.origin);
    if (!scope.environment || origin.origin !== scope.origin || origin.protocol !== 'https:' || origin.hostname !== rpID) return false;
    for (const value of [e.id, e.principal, e.credential, e.household, e.mandate, e.offer, e.presenter]) {
      if (typeof value !== 'string' || !value || value.length > 512 || /[\u0000-\u001f\u007f]/.test(value)) return false;
    }
    if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(e.expiresAt) || e.expiresAt <= now) return false;
    if (e.canonical !== canonical || Buffer.byteLength(canonical) > 65536 || e.offer !== offer.id || e.mandate !== offer.mandate || e.household !== offer.household || e.presenter !== offer.presenter) return false;
    for (const value of [e.keyFingerprint, e.reviewedRevision, e.requestDigest]) if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) return false;
    const fingerprint = createHash('sha256').update(createPublicKey(key).export({ type: 'spki', format: 'der' })).digest('hex');
    if (e.keyFingerprint !== fingerprint) return false;
    const request = JSON.stringify(['atarasy.member-decision-operation.1', JSON.stringify([1, e.environment, e.origin]), e.principal, e.credential, e.household, e.keyFingerprint, e.offer, e.mandate, e.presenter, e.canonical, e.reviewedRevision, e.expiresAt]);
    if (e.requestDigest !== digest(request)) return false;
    if (Object.keys(assertion).sort().join(',') !== 'authenticator_data,client_data_json,signature') return false;
    for (const value of Object.values(assertion)) {
      if (typeof value !== 'string' || !value || value.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(value) || Buffer.from(value, 'base64url').toString('base64url') !== value) return false;
    }
    const client = JSON.parse(Buffer.from(assertion.client_data_json, 'base64url').toString());
    if (!acceptsAssertionOrigin(scope.origin, scope.androidAppOrigins, client.origin) || (client.crossOrigin !== undefined && client.crossOrigin !== false) || client.topOrigin !== undefined) return false;
    return verifyAssertion(memberDecisionBytes(e), assertion, key, rpID);
  } catch { return false; }
}
/** Fixed field ordering preserves exact replay identity across JSON object order. */
export function memberDecisionIdentity(e: MemberDecisionEnvelope, a: Assertion): string {
  return digest(JSON.stringify([memberDecisionBytes(e).toString(), a.authenticator_data, a.client_data_json, a.signature]));
}
