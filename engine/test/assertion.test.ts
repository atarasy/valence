import { describe, expect, test } from "bun:test";
import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import {
  canonicalDecisions,
  challengeFor,
  confirmationToken,
  verifyDecisions,
  verifyDecisionAssertion,
  type DecisionInput,
} from "../src/shared/decisions.js";

/** §14b. The name this deployment declares, and the one the fixture signs for. */
const RP = "atarasy.example";
const pair = generateKeyPairSync("ed25519");
const pem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
const decisions: DecisionInput[] = [
  { candidate: "c-1", valence: "kept", kept_as: "self" },
  { candidate: "c-2", valence: "returned" },
];

/**
 * WebAuthn §6.1. The SHA-256 of a relying party id, one byte of flags and a
 * four-byte counter, which is the least an authenticator produces and where
 * the engine reads the flags from.
 */
function authenticatorData(flags: number, relyingParty = RP): Buffer {
  return Buffer.concat([
    createHash("sha256").update(relyingParty).digest(),
    Buffer.from([flags]),
    Buffer.from([0, 0, 0, 1]),
  ]);
}

/** ed25519 signs the bytes; a P-256 or RSA key signs their SHA-256. */
const digestFor = (key: KeyObject) => (key.asymmetricKeyType === "ed25519" ? null : "sha256");

/** What an authenticator does: sign its own data and the hash of the client's. */
function assertFor(
  challenge: string,
  options: { type?: string; flags?: number; key?: KeyObject; data?: Buffer; relyingParty?: string } = {}
) {
  const { type = "webauthn.get", flags = 0x05, key = pair.privateKey, relyingParty = RP } = options;
  const data = options.data ?? authenticatorData(flags, relyingParty);
  const clientDataJson = Buffer.from(
    JSON.stringify({ type, challenge, origin: "https://atarasy.example" }),
    "utf8"
  );
  const signed = Buffer.concat([data, createHash("sha256").update(clientDataJson).digest()]);
  return {
    authenticator_data: data.toString("base64"),
    client_data_json: clientDataJson.toString("base64"),
    signature: sign(digestFor(key), signed, key).toString("base64"),
  };
}

describe("§10.5: a passkey signs the decided set as its challenge", () => {
  test("an assertion whose challenge is this set is accepted", () => {
    const a = assertFor(challengeFor("o-1", decisions));
    expect(verifyDecisionAssertion("o-1", decisions, a, pem, RP)).toBe(true);
  });

  test("the challenge is the set, not a random number", () => {
    // The whole reason the challenge is not random: a random one proves a
    // person was present and says nothing about what they agreed to.
    const a = assertFor("Zm9vYmFyLXJhbmRvbS1jaGFsbGVuZ2U");
    expect(verifyDecisionAssertion("o-1", decisions, a, pem, RP)).toBe(false);
  });

  test("an assertion for one set does not cover another", () => {
    const a = assertFor(challengeFor("o-1", decisions));
    const other: DecisionInput[] = [{ candidate: "c-1", valence: "returned" }];
    expect(verifyDecisionAssertion("o-1", other, a, pem, RP)).toBe(false);
    expect(verifyDecisionAssertion("o-2", decisions, a, pem, RP)).toBe(false);
  });

  test("a registration ceremony is not a confirmation", () => {
    // webauthn.create proves a person made a key. Clause 35 asks what they
    // agreed to, and a create ceremony agrees to nothing.
    const a = assertFor(challengeFor("o-1", decisions), { type: "webauthn.create" });
    expect(verifyDecisionAssertion("o-1", decisions, a, pem, RP)).toBe(false);
  });

  test("a signature over the canonical bytes is not an assertion", () => {
    // The shape a passkey cannot produce, offered in the shape it cannot fill.
    const a = {
      authenticator_data: authenticatorData(0x05).toString("base64"),
      client_data_json: Buffer.from(
        JSON.stringify({ type: "webauthn.get", challenge: challengeFor("o-1", decisions) }),
        "utf8"
      ).toString("base64"),
      signature: sign(null, canonicalDecisions("o-1", decisions), pair.privateKey).toString("base64"),
    };
    expect(verifyDecisionAssertion("o-1", decisions, a, pem, RP)).toBe(false);
  });

  test("the challenge is base64url without padding, which is what a browser sends", () => {
    const c = challengeFor("o-1", decisions);
    expect(c).not.toContain("=");
    expect(c).not.toContain("+");
    expect(c).not.toContain("/");
  });
});

describe("§10.5: the flags say whether a person was there", () => {
  test("a device that did not verify the person did not confirm the set", () => {
    // User-present without user-verified: somebody touched the device, and
    // it did not check who. The signature proves a key was used; clause 35
    // asks that a person agreed.
    const a = assertFor(challengeFor("o-1", decisions), { flags: 0x01 });
    expect(verifyDecisionAssertion("o-1", decisions, a, pem, RP)).toBe(false);
  });

  test("a device with nobody at it did not confirm the set", () => {
    const a = assertFor(challengeFor("o-1", decisions), { flags: 0x04 });
    expect(verifyDecisionAssertion("o-1", decisions, a, pem, RP)).toBe(false);
  });

  test("other flags beside the two are not the engine's business", () => {
    // Backup eligibility, attested credential data, extensions: an
    // authenticator may set any of them, and a person who was present and
    // verified still confirmed the set.
    const a = assertFor(challengeFor("o-1", decisions), { flags: 0xdd });
    expect(verifyDecisionAssertion("o-1", decisions, a, pem, RP)).toBe(true);
  });

  test("authenticator data too short to carry flags is refused", () => {
    // Anything shorter than the relying party hash, the flags and the counter
    // was never made by an authenticator, and the engine reads it as a device
    // that said nothing about who was there.
    //
    // The data here is right in every other way: the relying party's own hash,
    // then a byte with both flags set, and nothing after it. A first version
    // of this test sent 33 bytes of a string, which the relying party check
    // refused before the length was ever read, so the test passed with the
    // length guard removed. Measured 2026-09-11.
    const a = assertFor(challengeFor("o-1", decisions), {
      data: Buffer.concat([createHash("sha256").update(RP).digest(), Buffer.from([0x05])]),
    });
    expect(verifyDecisionAssertion("o-1", decisions, a, pem, RP)).toBe(false);
  });
});

describe("§10.5: the registered key says how its signature is checked", () => {
  test("a P-256 key, which is what most phones and laptops carry, verifies (ES256)", () => {
    const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const ecPem = ec.publicKey.export({ type: "spki", format: "pem" }).toString();
    const a = assertFor(challengeFor("o-1", decisions), { key: ec.privateKey });
    expect(verifyDecisionAssertion("o-1", decisions, a, ecPem, RP)).toBe(true);
  });

  test("an RSA key verifies (RS256)", () => {
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const rsaPem = rsa.publicKey.export({ type: "spki", format: "pem" }).toString();
    const a = assertFor(challengeFor("o-1", decisions), { key: rsa.privateKey });
    expect(verifyDecisionAssertion("o-1", decisions, a, rsaPem, RP)).toBe(true);
  });

  test("a signature by a key of another type than the one registered is refused", () => {
    // The mandate's key is ed25519; the assertion was signed on P-256. The
    // registered key decides, and this one does not verify it.
    const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const a = assertFor(challengeFor("o-1", decisions), { key: ec.privateKey });
    expect(verifyDecisionAssertion("o-1", decisions, a, pem, RP)).toBe(false);
  });
});

describe("§10.5, §14b: an assertion is made for one site", () => {
  test("an assertion made for another relying party is refused", () => {
    // A member's device signed for some other hub's name. The challenge and
    // the signature are both good, and the set was still not confirmed here.
    const a = assertFor(challengeFor("o-1", decisions), { relyingParty: "elsewhere.example" });
    expect(verifyDecisionAssertion("o-1", decisions, a, pem, RP)).toBe(false);
  });

  test("the name is compared as the authenticator hashes it, byte for byte", () => {
    const a = assertFor(challengeFor("o-1", decisions));
    expect(verifyDecisionAssertion("o-1", decisions, a, pem, "Atarasy.example")).toBe(false);
  });
});

describe("§10.5: a bare signature is checked by its key's type too", () => {
  // The assertion shape is not the only one a member's key is used for. A
  // household that joined through a hub holds a P-256 passkey, and until
  // 2026-09-11 `verifyDecisions` checked every signature the way ed25519 is
  // checked, so that household could confirm nothing with a bare signature,
  // could co-sign nothing (§16.4) and could sign no change to its own mandate
  // (§16.1). The exceptions threw rather than returning false: it was not a
  // check they failed, it was one they could not reach.
  const sets = [
    ["ed25519", generateKeyPairSync("ed25519")],
    ["P-256", generateKeyPairSync("ec", { namedCurve: "prime256v1" })],
    ["RSA", generateKeyPairSync("rsa", { modulusLength: 2048 })],
  ] as const;

  for (const [name, keys] of sets) {
    test(`a set signed with a ${name} key verifies against that key`, () => {
      const keyPem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
      const digest = keys.privateKey.asymmetricKeyType === "ed25519" ? null : "sha256";
      const signature = sign(digest, canonicalDecisions("o-1", decisions), keys.privateKey).toString("base64");
      expect(verifyDecisions("o-1", decisions, signature, keyPem)).toBe(true);
      expect(verifyDecisions("o-2", decisions, signature, keyPem)).toBe(false);
    });
  }
});

describe("§10.5: what identifies a confirmation, so one cannot be used twice", () => {
  // Found by a second adversarial round on 2026-09-11, against the first fix.
  // The register held the string that was posted, and `Buffer.from(x,
  // "base64")` reads far more strings than one: a decided set taken back
  // inside its cooling window went back by resending the same signature with
  // a space in it.
  const ed = generateKeyPairSync("ed25519");
  const edPem = ed.publicKey.export({ type: "spki", format: "pem" }).toString();
  const bytes = canonicalDecisions("o-1", decisions);
  const edSig = sign(null, bytes, ed.privateKey).toString("base64");

  test("the same signature spelled differently is the same confirmation", () => {
    const token = confirmationToken(edPem, edSig);
    for (const spelling of [
      edSig.replace(/=+$/, ""),
      edSig.replace(/\+/g, "-").replace(/\//g, "_"),
      `${edSig.slice(0, 8)} ${edSig.slice(8)}`,
      `${edSig.slice(0, 8)}\n${edSig.slice(8)}`,
      `${edSig}!`,
    ]) {
      expect(verifyDecisions("o-1", decisions, spelling, edPem)).toBe(true);
      expect(confirmationToken(edPem, spelling)).toBe(token);
    }
  });

  test("an ECDSA signature and its twin are the same confirmation", () => {
    // (r, s) and (r, n - s) both verify against the same key and the same
    // message, and anyone who has seen one can compute the other without the
    // key. The same round put a withdrawn set back with the twin.
    const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const ecPem = ec.publicKey.export({ type: "spki", format: "pem" }).toString();
    const der = sign("sha256", bytes, ec.privateKey);
    // Read the DER pair, negate s modulo the curve order, and write it back.
    const N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
    let i = 2;
    const readInt = () => {
      i += 1;
      const len = der[i]!;
      i += 1;
      const v = BigInt(`0x${der.subarray(i, i + len).toString("hex")}`);
      i += len;
      return v;
    };
    const r = readInt();
    const s = readInt();
    const enc = (v: bigint) => {
      let hex = v.toString(16);
      if (hex.length % 2) hex = `0${hex}`;
      let b = Buffer.from(hex, "hex");
      if (b[0]! & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
      return Buffer.concat([Buffer.from([0x02, b.length]), b]);
    };
    const body = Buffer.concat([enc(r), enc(N - s)]);
    const twin = Buffer.concat([Buffer.from([0x30, body.length]), body]).toString("base64");
    expect(verifyDecisions("o-1", decisions, twin, ecPem)).toBe(true);
    expect(confirmationToken(ecPem, twin)).toBe(confirmationToken(ecPem, der.toString("base64")));
  });

  test("two different signatures are two confirmations", () => {
    const other = generateKeyPairSync("ed25519");
    const otherPem = other.publicKey.export({ type: "spki", format: "pem" }).toString();
    const otherSig = sign(null, bytes, other.privateKey).toString("base64");
    expect(confirmationToken(otherPem, otherSig)).not.toBe(confirmationToken(edPem, edSig));
  });
});
