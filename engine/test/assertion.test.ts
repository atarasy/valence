import { describe, expect, test } from "bun:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import {
  canonicalDecisions,
  challengeFor,
  verifyDecisionAssertion,
  type DecisionInput,
} from "../src/shared/decisions.js";

const pair = generateKeyPairSync("ed25519");
const pem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
const decisions: DecisionInput[] = [
  { candidate: "c-1", valence: "kept", kept_as: "self" },
  { candidate: "c-2", valence: "returned" },
];

/** What an authenticator does: sign its own data and the hash of the client's. */
function assertFor(challenge: string, type = "webauthn.get") {
  const authenticatorData = Buffer.from("authenticator-data-of-some-length");
  const clientDataJson = Buffer.from(
    JSON.stringify({ type, challenge, origin: "https://atarasy.example" }),
    "utf8"
  );
  const signed = Buffer.concat([
    authenticatorData,
    createHash("sha256").update(clientDataJson).digest(),
  ]);
  return {
    authenticator_data: authenticatorData.toString("base64"),
    client_data_json: clientDataJson.toString("base64"),
    signature: sign(null, signed, pair.privateKey).toString("base64"),
  };
}

describe("§10.5: a passkey signs the decided set as its challenge", () => {
  test("an assertion whose challenge is this set is accepted", () => {
    const a = assertFor(challengeFor("o-1", decisions));
    expect(verifyDecisionAssertion("o-1", decisions, a, pem)).toBe(true);
  });

  test("the challenge is the set, not a random number", () => {
    // The whole reason the challenge is not random: a random one proves a
    // person was present and says nothing about what they agreed to.
    const a = assertFor("Zm9vYmFyLXJhbmRvbS1jaGFsbGVuZ2U");
    expect(verifyDecisionAssertion("o-1", decisions, a, pem)).toBe(false);
  });

  test("an assertion for one set does not cover another", () => {
    const a = assertFor(challengeFor("o-1", decisions));
    const other: DecisionInput[] = [{ candidate: "c-1", valence: "returned" }];
    expect(verifyDecisionAssertion("o-1", other, a, pem)).toBe(false);
    expect(verifyDecisionAssertion("o-2", decisions, a, pem)).toBe(false);
  });

  test("a registration ceremony is not a confirmation", () => {
    // webauthn.create proves a person made a key. Clause 35 asks what they
    // agreed to, and a create ceremony agrees to nothing.
    const a = assertFor(challengeFor("o-1", decisions), "webauthn.create");
    expect(verifyDecisionAssertion("o-1", decisions, a, pem)).toBe(false);
  });

  test("a signature over the canonical bytes is not an assertion", () => {
    // The shape a passkey cannot produce, offered in the shape it cannot fill.
    const a = {
      authenticator_data: Buffer.from("authenticator-data-of-some-length").toString("base64"),
      client_data_json: Buffer.from(
        JSON.stringify({ type: "webauthn.get", challenge: challengeFor("o-1", decisions) }),
        "utf8"
      ).toString("base64"),
      signature: sign(null, canonicalDecisions("o-1", decisions), pair.privateKey).toString("base64"),
    };
    expect(verifyDecisionAssertion("o-1", decisions, a, pem)).toBe(false);
  });

  test("the challenge is base64url without padding, which is what a browser sends", () => {
    const c = challengeFor("o-1", decisions);
    expect(c).not.toContain("=");
    expect(c).not.toContain("+");
    expect(c).not.toContain("/");
  });
});
