import { createHash, createPublicKey, verify } from "node:crypto";
import type { KeptAs, Valence } from "../common/types.js";

/**
 * Clause 35. A confirmation is the person's signature over the decided set,
 * in the AP2 mandate form. The set is signed in this canonical shape, so a
 * signature made by one hub verifies at any conforming endpoint:
 *
 *   <offer id>
 *   <candidate>:<valence>:<kept_as or empty>:<lineage or empty>   (one line
 *   per decision, in ascending candidate id, UTF-8, "\n" between lines)
 *
 * The signature is ed25519 over those bytes, base64. The key is the one
 * registered for the offer's mandate.
 */
export type DecisionInput = {
  candidate: string;
  valence: Valence;
  kept_as?: KeptAs;
  lineage?: string;
};

export function canonicalDecisions(offerId: string, decisions: DecisionInput[]): Buffer {
  const lines = [...decisions]
    .sort((a, b) => (a.candidate < b.candidate ? -1 : a.candidate > b.candidate ? 1 : 0))
    .map((d) => `${d.candidate}:${d.valence}:${d.kept_as ?? ""}:${d.lineage ?? ""}`);
  return Buffer.from([offerId, ...lines].join("\n"), "utf8");
}

export function verifyDecisions(
  offerId: string,
  decisions: DecisionInput[],
  signature: string,
  publicKeyPem: string
): boolean {
  try {
    return verify(
      null,
      canonicalDecisions(offerId, decisions),
      createPublicKey(publicKeyPem),
      Buffer.from(signature, "base64")
    );
  } catch {
    return false;
  }
}

/**
 * §10.5. What a member's device sends instead of a bare signature.
 *
 * An authenticator signs the concatenation of its own `authenticatorData` and
 * the SHA-256 of `clientDataJSON`, never bytes a caller hands it, so the
 * canonical form of a decided set cannot be signed by a passkey directly. It
 * travels as the **challenge** instead, which is why the challenge here is not
 * random: a random one proves a person was present and says nothing about what
 * they agreed to, and clause 35 is about what they agreed to.
 */
export type DecisionAssertion = {
  authenticator_data: string;
  client_data_json: string;
  signature: string;
};

/** §10.5. The challenge a decided set produces: base64url of its SHA-256, unpadded. */
export function challengeFor(offerId: string, decisions: DecisionInput[]): string {
  return createHash("sha256")
    .update(canonicalDecisions(offerId, decisions))
    .digest("base64url");
}

export function verifyDecisionAssertion(
  offerId: string,
  decisions: DecisionInput[],
  assertion: DecisionAssertion,
  publicKeyPem: string
): boolean {
  try {
    const clientData = Buffer.from(assertion.client_data_json, "base64");
    const parsed = JSON.parse(clientData.toString("utf8")) as {
      type?: unknown;
      challenge?: unknown;
    };
    // The challenge is the decided set. An assertion whose challenge is
    // anything else is a person confirming something this offer is not.
    if (parsed.challenge !== challengeFor(offerId, decisions)) return false;
    // `webauthn.get` is the assertion ceremony. A registration ceremony
    // replayed here would be a person proving they made a key, not that they
    // agreed to this.
    if (parsed.type !== "webauthn.get") return false;
    const signed = Buffer.concat([
      Buffer.from(assertion.authenticator_data, "base64"),
      createHash("sha256").update(clientData).digest(),
    ]);
    return verify(
      null,
      signed,
      createPublicKey(publicKeyPem),
      Buffer.from(assertion.signature, "base64")
    );
  } catch {
    return false;
  }
}
