import { createPublicKey, verify } from "node:crypto";
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
