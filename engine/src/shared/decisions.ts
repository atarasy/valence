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

/**
 * §10.5. **A signature is verified by the type of the key it is checked
 * against.** ed25519 signs the bytes as they are. A key on the P-256 curve,
 * which is what most phones and laptops carry and what a passkey registered
 * through a hub almost always is, signs their SHA-256 (ES256), and so does an
 * RSA key (RS256).
 *
 * Every verification here went through `verify(null, ...)` until 2026-09-11,
 * which is ed25519's form alone, so a member who joined with a passkey could
 * register a key, confirm nothing with it, and co-sign nothing. The
 * exceptions throw rather than returning false, so this is not a check that
 * merely refused them; it is one they could not reach.
 */
export function verifyBy(publicKeyPem: string, data: Buffer, signature: Buffer): boolean {
  try {
    const key = createPublicKey(publicKeyPem);
    return verify(key.asymmetricKeyType === "ed25519" ? null : "sha256", data, key, signature);
  } catch {
    return false;
  }
}

export function verifyDecisions(
  offerId: string,
  decisions: DecisionInput[],
  signature: string,
  publicKeyPem: string
): boolean {
  return verifyBy(
    publicKeyPem,
    canonicalDecisions(offerId, decisions),
    Buffer.from(signature, "base64")
  );
}

/**
 * §10.5. What identifies a confirmation, so that one cannot be used twice.
 *
 * **Not the string that was posted.** `Buffer.from(x, "base64")` is lenient:
 * it ignores whitespace and padding, reads the base64url alphabet, and stops
 * at the first character it cannot use. So one signature has an unbounded
 * number of spellings, every one of them verifies, and a register of strings
 * holds none of the others. Measured on 2026-09-11 by an adversarial pass:
 * a decided set taken back inside its cooling window was put back by resending
 * the same signature with a space in it.
 *
 * **And not the bytes alone, for ECDSA.** A signature `(r, s)` has a twin
 * `(r, n - s)` that verifies against the same key and the same message, and
 * nothing in the standard forbids it. The same pass computed the twin from a
 * captured assertion, without the key, and put the withdrawn set back with it.
 * So an ECDSA signature is reduced to the half of the pair with the smaller
 * `s` before it is registered, which is the form the two share.
 *
 * A curve this table does not know is registered by its bytes, and the twin
 * of such a signature would not be caught. The runtime reaches P-256, P-384
 * and P-521 and no other curve.
 */
const CURVE_ORDER: Record<string, bigint> = {
  prime256v1: 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n,
  secp384r1:
    0xffffffffffffffffffffffffffffffffffffffffffffffffc7634d81f4372ddf581a0db248b0a77aecec196accc52973n,
  secp521r1:
    0x01fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffa51868783bf2f966b7fcc0148f709a5d03bb5c9b8899c47aebb6fb71e91386409n,
};

/** DER: SEQUENCE { INTEGER r, INTEGER s }. Returns null for anything else. */
function readDerPair(der: Buffer): { r: bigint; s: bigint } | null {
  let i = 0;
  const int = (): bigint | null => {
    if (der[i] !== 0x02) return null;
    i += 1;
    const len = der[i];
    if (len === undefined || len > 0x7f) return null;
    i += 1;
    const slice = der.subarray(i, i + len);
    if (slice.length !== len) return null;
    i += len;
    return BigInt(`0x${slice.toString("hex") || "0"}`);
  };
  if (der[0] !== 0x30) return null;
  const total = der[1];
  if (total === undefined || total > 0x7f || total + 2 !== der.length) return null;
  i = 2;
  const r = int();
  if (r === null) return null;
  const s = int();
  if (s === null || i !== der.length) return null;
  return { r, s };
}

export function confirmationToken(publicKeyPem: string, signature: string): string {
  const bytes = Buffer.from(signature, "base64");
  try {
    const key = createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType === "ec") {
      const curve = (key.asymmetricKeyDetails as { namedCurve?: string } | undefined)?.namedCurve;
      const order = curve ? CURVE_ORDER[curve] : undefined;
      const pair = order ? readDerPair(bytes) : null;
      if (order && pair) {
        const s = pair.s * 2n > order ? order - pair.s : pair.s;
        return `ec:${pair.r.toString(16)}:${s.toString(16)}`;
      }
    }
  } catch {
    // An unreadable key is the verifier's problem, not this function's. The
    // bytes still identify what was posted.
  }
  return `raw:${bytes.toString("hex")}`;
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

/**
 * WebAuthn §6.1. Authenticator data opens with the SHA-256 of the relying
 * party's id, one byte of flags and a four-byte signature counter, so the
 * flags sit at byte 32 and anything shorter than 37 bytes was never made by
 * an authenticator.
 */
const AUTHENTICATOR_DATA_MIN = 37;
const FLAGS_OFFSET = 32;
/** The person touched the device. */
const USER_PRESENT = 0x01;
/** The device checked that it was them: a biometric, a PIN, a pattern. */
const USER_VERIFIED = 0x04;

/**
 * §10.5, §14b. `relyingPartyId` is the name of the hub the assertion was made
 * for, which a deployment declares because nothing else tells an engine which
 * hub it is. An authenticator signs the SHA-256 of that name as the first 32
 * bytes of its data, so an assertion made for another site, however good its
 * challenge and its signature, was not made for this one.
 *
 * It has no default and an engine refuses to start without one (§14b). The
 * alternative considered was to refuse the assertion shape where no name is
 * declared, and it is wrong: §10.5 says an implementation MUST accept both
 * shapes, so an engine that cannot check an assertion is not a conforming
 * engine with a shape switched off. On a split deployment the name is the
 * hub's and the engine is told it, which is one more thing on §13.1's
 * interface.
 */
export function verifyDecisionAssertion(
  offerId: string,
  decisions: DecisionInput[],
  assertion: DecisionAssertion,
  publicKeyPem: string,
  relyingPartyId: string
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
    const authenticatorData = Buffer.from(assertion.authenticator_data, "base64");
    // The first 32 bytes name the site the assertion was made for. Until
    // 2026-09-11 nothing told an engine its own name, so this was not read.
    const relyingParty = createHash("sha256").update(relyingPartyId).digest();
    if (!authenticatorData.subarray(0, 32).equals(relyingParty)) return false;
    // A device that signed without checking who was at it, or with nobody at
    // it, proves that a key was used. Clause 35 asks that a person agreed.
    // Until 2026-09-11 the flags were not read, and an assertion made without
    // either was taken for one made with both.
    const flags =
      authenticatorData.length >= AUTHENTICATOR_DATA_MIN ? authenticatorData[FLAGS_OFFSET]! : 0;
    if ((flags & USER_VERIFIED) === 0) return false;
    if ((flags & USER_PRESENT) === 0) return false;
    const signed = Buffer.concat([
      authenticatorData,
      createHash("sha256").update(clientData).digest(),
    ]);
    return verifyBy(publicKeyPem, signed, Buffer.from(assertion.signature, "base64"));
  } catch {
    return false;
  }
}
