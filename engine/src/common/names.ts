import { createHash, createPublicKey } from "node:crypto";

/**
 * §13.2, question 55, decided 2026-09-16. **A name a signature is checked
 * against is the key.**
 *
 * A household's identifier is `key:` and the base64url SHA-256 of its public
 * key in SubjectPublicKeyInfo DER form, and a mandate's is that identifier, a
 * full stop and a label. Nothing looks a mandate's key up: a decided set, a
 * settlement statement and a mandate version are all checked against the
 * household's own.
 *
 * What it replaces is a registry where a name was free, global and permanent.
 * Measured on the engine the morning it was decided: whoever registered a key
 * under a household's name recorded that household's mandate, ceilings and
 * co-signers included; whoever registered one under a mandate's name decided
 * that household's set; and the household was then refused its own key with
 * `409 identity_exists`, with no route that removes one. The defence before
 * this was an unguessable name, and an offer carries `household` and
 * `mandate` into `valence-merchant/1`, so both names reach every merchant the
 * household buys from.
 *
 * The name commits to the key by hash rather than carrying it, because the
 * verifier reaches ed25519, P-256, P-384 and RSA (§10.5) and a `did:key`
 * carrying an RSA key is about 380 characters in every path and every export.
 * The cost is that `/_identities` goes on holding key material; what it gains
 * is that the key may be accepted from anybody, because the name proves it.
 */
const PREFIX = "key:";

/** The base64url SHA-256 of a 32-byte digest is 43 characters. */
const HOUSEHOLD = /^key:[A-Za-z0-9_-]{43}$/;
const MANDATE = /^(key:[A-Za-z0-9_-]{43})\.[A-Za-z0-9_-]{1,64}$/;

/** The identifier a public key has. The DER is re-exported, so the PEM's own whitespace does not reach the name. */
export function nameOf(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  return PREFIX + createHash("sha256").update(der).digest("base64url");
}

/** Whether a name claims to be a key. A name that claims it is checked against the key. */
export function claimsToBeAKey(name: string): boolean {
  return name.startsWith(PREFIX);
}

/** Whether a name is a household's identifier. */
export function isHouseholdName(name: string): boolean {
  return HOUSEHOLD.test(name);
}

/**
 * The household a mandate identifier names, or `undefined` where the
 * identifier is not one. This is the whole of the lookup: a mandate has no key
 * of its own, so there is nothing to register under its name and nothing to
 * take by registering first.
 */
export function householdOfMandate(id: string): string | undefined {
  return MANDATE.exec(id)?.[1];
}
