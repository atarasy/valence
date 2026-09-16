import { describe, expect, test } from "bun:test";
import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { HOUSEHOLD, MANDATE, makeEngine } from "./helpers.js";
import { householdOfMandate, isHouseholdName, nameOf } from "../src/common/names.js";
import { createApp } from "../src/http.js";
import { ApprovalDesk } from "../src/hub/approval.js";
import { DeliveryRegister } from "../src/hub/delivery.js";
import { RecoveryRegister } from "../src/hub/node.js";
import { PermissionLedger } from "../src/hub/permissions.js";
import { Registry } from "../src/shared/registry.js";

/**
 * §13.2, question 55, decided 2026-09-16. A name a signature is checked
 * against is the key. What this replaces is a registry where a name was free,
 * global and permanent, so whoever registered a household's name first held
 * the key its mandates and its decided sets were checked against.
 */
describe("§13.2, question 55: a name is its key", () => {
  const pemOf = (k: KeyObject) => k.export({ type: "spki", format: "pem" }).toString();

  test("a name is the same for every kind of key the verifier reaches, and does not read the PEM's whitespace", () => {
    // §10.5 verifies ed25519, ECDSA and RSA, which is why the name commits to
    // the key by hash rather than carrying it: a `did:key` with an RSA key
    // inside is about 380 characters in every path and every export.
    const pairs = [
      generateKeyPairSync("ed25519"),
      generateKeyPairSync("ec", { namedCurve: "prime256v1" }),
      generateKeyPairSync("ec", { namedCurve: "secp384r1" }),
      generateKeyPairSync("rsa", { modulusLength: 2048 }),
    ];
    for (const { publicKey } of pairs) {
      const pem = pemOf(publicKey);
      const name = nameOf(pem);
      expect(name.length).toBe(47);
      expect(isHouseholdName(name)).toBe(true);
      // The DER is re-exported before it is hashed, so a PEM that was folded
      // differently on the way is the same key with the same name.
      expect(nameOf(pem.replace(/\n/g, "\r\n").trim() + "\n")).toBe(name);
    }
  });

  test("a mandate names its household and nothing else", () => {
    expect(householdOfMandate(MANDATE)).toBe(HOUSEHOLD);
    expect(householdOfMandate(HOUSEHOLD)).toBeUndefined();
    expect(householdOfMandate(`${HOUSEHOLD}.`)).toBeUndefined();
    expect(householdOfMandate(`${HOUSEHOLD}.a.b`)).toBeUndefined();
    expect(householdOfMandate("mandate-1")).toBeUndefined();
  });

  test("a `key:` name is refused for a key it does not name", () => {
    // NOTE (mutation check, 2026-09-16): identity_name_unchecked stops
    // comparing. This assertion failed with a registration: the squat the
    // whole question is about.
    const { engine } = makeEngine();
    const { publicKey } = generateKeyPairSync("ed25519");
    expect(() => engine.registerIdentity(HOUSEHOLD, pemOf(publicKey)))
      .toThrow(expect.objectContaining({ code: "name_is_not_the_key" }));
    // A key that does not parse has no name, which is the same refusal.
    expect(() => engine.registerIdentity(HOUSEHOLD, "not a key"))
      .toThrow(expect.objectContaining({ code: "name_is_not_the_key" }));
    // A name that claims nothing is still the registry's to hand out: a
    // presenter's and a giver's stay first-come under §5.2's limit.
    expect(() => engine.registerIdentity("merchant-2", pemOf(publicKey))).not.toThrow();
  });

  test("a mandate is not recorded under an identifier that is not its household's", () => {
    // NOTE (mutation check, 2026-09-16): mandate_record_shape_unchecked.
    const { engine } = makeEngine();
    const record = (id: string, household: string) =>
      engine.mandates.record({
        mandate: { id, household, ceiling_out_of_network: 1, co_signers: [], ceiling_daily: null,
          cooling_seconds: null, lapses_at: Date.now() + 3_600_000, version: 1 },
        signatures: {}, assertions: {}, keyOf: () => undefined, relyingPartyId: "unit.example",
      });
    expect(() => record("mandate-1", "owner"))
      .toThrow(expect.objectContaining({ code: "name_is_not_the_key" }));
    expect(() => record("mandate-1", HOUSEHOLD))
      .toThrow(expect.objectContaining({ code: "name_is_not_the_key" }));
    // Its own household's identifier with a label gets past the shape and is
    // then refused for the signature it does not carry, which is §16.1's.
    expect(() => record(MANDATE, HOUSEHOLD))
      .toThrow(expect.objectContaining({ code: "unsigned" }));
  });
});

describe("§13.2: a path segment a caller wrote", () => {
  test("a malformed percent sequence is refused by name, not by a 500", async () => {
    // NOTE (mutation check, 2026-09-16): path_segment_unnamed_failure. The
    // answer was `500 internal`, which tells a caller nothing and tells a
    // probe less. Six routes gained a decoded segment with question 55 and two
    // had one already.
    const { engine } = makeEngine();
    const handle = createApp(engine, {
      deliveries: new DeliveryRegister(),
      approvals: new ApprovalDesk(),
      recovery: new RecoveryRegister(),
      permissions: new PermissionLedger(),
      registry: new Registry(),
    });
    for (const path of ["/households/%zz/export", "/households/%zz/import", "/_node/mandates/%zz"]) {
      const r = await handle(new Request(`https://unit.example${path}`, { method: path.endsWith("import") ? "POST" : "GET", body: path.endsWith("import") ? "{}" : undefined }));
      expect([path, r.status]).toEqual([path, 400]);
      expect([path, ((await r.json()) as { error: string }).error]).toEqual([path, "malformed"]);
    }
  });
});
