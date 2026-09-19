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
  function held(token: string, id?: string): { household: string; principal: string; claim: Mandate } {
    const session = r.authority.sessionPrincipal(token);
    if (!session) throw new Error('Mandate ceremony unavailable');
    const claims = r.engine.mandates.claimsFor(session.household);
    // Named when there are several, because the count is not the household's
    // to control: anybody may write a claim. A ceremony that required exactly
    // one could be stopped by a stranger writing a second, which a refutation
    // pass measured on 2026-09-18 while a claim still had an effect.
    const claim = id === undefined ? (claims.length === 1 ? claims[0] : undefined) : claims.find((m) => m.id === id);
    if (!claim) throw new Error(`No such unsigned mandate; this household has ${claims.length}`);
    if (householdOfMandate(claim.id) !== session.household) throw new Error('Mandate ceremony unavailable');
    return { household: session.household, principal: session.principal, claim };
  }

  return {
    /** What the device is being asked to sign, and the options to sign it with. */
    /**
     * The claims this household has, or the one it named. A client that has
     * been restored or reinstalled knows no identifier, and nothing else on
     * this service lists one: `GET /_node/mandates/{id}` answers 404 for a
     * claim by design. Measured by a refutation pass on 2026-09-18, which
     * found the ceremony unreachable for exactly that client.
     */
    list(token: string) {
      const session = r.authority.sessionPrincipal(token);
      if (!session) throw new Error('Mandate ceremony unavailable');
      return { mandates: r.engine.mandates.claimsFor(session.household) };
    },
    prepare(token: string, id?: string) {
      const { principal, claim } = held(token, id);
      return {
        mandate: claim,
        publicKey: {
          challenge: challengeForBytes(canonicalMandate(claim, policy.rpID)),
          rpId: policy.rpID,
          userVerification: 'required' as const,
          allowCredentials: r.authority.activeCredentialIDs(principal).map((id) => ({ type: 'public-key' as const, id })),
        },
      };
    },
    /**
     * Record the claim as it stands, which is the only thing a claim is for:
     * the engine takes a submission as the claim only when its bytes are the
     * claim's, so nothing here can quietly sign different terms. It verifies
     * the assertion against the household's own key, which is the key the
     * identifier names, so a submission signed by anything else is refused
     * there rather than here.
     */
    submit(token: string, assertion: Assertion, id?: string) {
      const { household, claim } = held(token, id);
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
