import { canonicalMandate, type Mandate } from '../../engine/src/hub/mandates.ts';
import { challengeForBytes, type Assertion } from '../../engine/src/shared/decisions.ts';
import { householdOfMandate } from '../../engine/src/common/names.ts';
import type { memberRuntime } from './runtime.ts';

/**
 * §16.1 and §14.2, question 56, decided 2026-09-18. **A mandate that arrives by
 * a move is a claim until the household signs it at the host it arrived at.**
 *
 * The household's key on this service is the device's own passkey, so the
 * signature is the assertion shape §10.5 defines, and the engine's `record` is
 * what verifies it: the challenge is the SHA-256 of the canonical bytes, the
 * relying party is this deployment, and a claim that is signed becomes a
 * mandate at the version it carries.
 *
 * Nothing here composes the terms. What the device signs is the claim exactly
 * as it arrived, which is what makes a planted claim harmless: it becomes a
 * mandate only if the person holding that household's key agrees to it, and
 * they can read what they are agreeing to before they do.
 */
export function openMandateCeremony(r: ReturnType<typeof memberRuntime>, policy: { rpID: string }) {
  function held(token: string): { household: string; principal: string; claim: Mandate } {
    const session = r.authority.sessionPrincipal(token);
    if (!session) throw new Error('Mandate ceremony unavailable');
    const claims = r.engine.mandates
      .forHousehold(session.household)
      .filter((m) => r.engine.mandates.claimFor(m.id) !== undefined);
    // One at a time, on purpose: a person agreeing to two sets of protections
    // in one gesture cannot be said to have read either.
    if (claims.length !== 1) throw new Error(`Exactly one unsigned mandate is required; this household has ${claims.length}`);
    const claim = claims[0]!;
    if (householdOfMandate(claim.id) !== session.household) throw new Error('Mandate ceremony unavailable');
    return { household: session.household, principal: session.principal, claim };
  }
  return {
    /** What the device is being asked to sign, and the options to sign it with. */
    prepare(token: string) {
      const { principal, claim } = held(token);
      return {
        mandate: claim,
        publicKey: {
          challenge: challengeForBytes(canonicalMandate(claim)),
          rpId: policy.rpID,
          userVerification: 'required' as const,
          allowCredentials: r.authority.activeCredentialIDs(principal).map((id) => ({ type: 'public-key' as const, id })),
        },
      };
    },
    /**
     * Record the claim as it stands. The engine verifies the assertion against
     * the household's own key, which is the key the identifier names, so a
     * submission signed by anything else is refused there rather than here.
     */
    submit(token: string, assertion: Assertion) {
      const { household, claim } = held(token);
      return r.engine.mandates.record({
        mandate: claim,
        signatures: {},
        assertions: { [household]: assertion },
        keyOf: (key: string) => r.engine.publicKeyFor(key),
        relyingPartyId: policy.rpID,
      });
    },
  };
}
