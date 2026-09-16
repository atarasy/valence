import { describe, expect, test } from "bun:test";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { CONFIG_VERSION, HOUR, HOUSEHOLD, MANDATE, MANDATE_PAIR, decideSigned, houseFor, makeEngine } from "./helpers.js";
import { canonicalMandate } from "../src/hub/mandates.js";
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

  test("a name that is not the encoding of 32 bytes is not a household", () => {
    // NOTE (mutation check, 2026-09-16): household_name_not_canonical. §13.2.
    // The last character carries four bits of digest and two that must be
    // zero, so a name that decodes and does not encode back to itself is one
    // no key has and two of them could stand for one household.
    const canonical = "key:" + "A".repeat(43);
    expect(isHouseholdName(canonical)).toBe(true);
    expect(Buffer.from(canonical.slice(4), "base64url").toString("base64url")).toBe(canonical.slice(4));
    for (const tail of ["B", "C", "F", "R", "x", "9"]) {
      const name = "key:" + "A".repeat(42) + tail;
      expect([tail, isHouseholdName(name)]).toEqual([tail, false]);
      expect([tail, householdOfMandate(`${name}.1`)]).toEqual([tail, undefined]);
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
    // NOTE (mutation check, 2026-09-16): identity_pem_text_compared. The same
    // key folded differently answered `409 identity_exists`, so a party that
    // knew a household's public key could file it re-wrapped and the
    // household's own enrolment then failed. Found by a review pass.
    const folded = pemOf(publicKey).replace(/\n/g, "\r\n");
    expect(() => engine.registerIdentity("merchant-2", folded)).not.toThrow();
    expect(() => engine.registerIdentity("merchant-2", pemOf(generateKeyPairSync("ed25519").publicKey)))
      .toThrow(expect.objectContaining({ code: "identity_exists" }));
    // NOTE (mutation check, 2026-09-16): identity_junk_pem_overwrites. A PEM
    // that does not parse has no key, and comparing keys made two such equal
    // to each other, so the second overwrote the first under a free name.
    // Found by reading this change's own diff.
    engine.registerIdentity("merchant-3", "not a key at all");
    expect(() => engine.registerIdentity("merchant-3", "some other rubbish"))
      .toThrow(expect.objectContaining({ code: "identity_exists" }));
    expect(() => engine.registerIdentity("merchant-3", "not a key at all")).not.toThrow();
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

  test("a co-signer is named by the key it signs with", () => {
    // NOTE (mutation check, 2026-09-16): cosigner_name_unchecked. A stranger
    // registers `mum`; the household records its first version naming `mum`,
    // which needs nobody else's signature; and every loosening after that is
    // the stranger's to sign. Clause 47 rests on who the named people are.
    // Found by a refutation pass over the question 55 work.
    const { engine } = makeEngine();
    const family = houseFor("mum").household;
    const version = (co: string[]) => ({
      id: MANDATE, household: HOUSEHOLD, ceiling_out_of_network: 1, co_signers: co,
      ceiling_daily: null, cooling_seconds: null, lapses_at: Date.now() + 3_600_000, version: 1,
    });
    const record = (co: string[]) => engine.mandates.record({
      mandate: version(co) as never, signatures: {}, assertions: {},
      keyOf: () => undefined, relyingPartyId: "unit.example",
    });
    expect(() => record(["mum"])).toThrow(expect.objectContaining({ code: "name_is_not_the_key" }));
    // A key-shaped co-signer gets past the shape and is then refused for the
    // signature it does not carry.
    expect(() => record([family])).toThrow(expect.objectContaining({ code: "unsigned" }));
  });

  test("a mandate still does not change hands, on a row that predates the shape", () => {
    // NOTE (mutation check, 2026-09-16): record_mandate_changes_hands.
    // §16.1's `wrong_household` is unreachable through the shape above, since
    // an identifier that begins with this household cannot be held for
    // another. It stays as the guard it was and is reached here the way a host
    // running the older rule would hold one, because an unreachable guard is
    // one nothing proves.
    const { engine } = makeEngine();
    const elsewhere = houseFor("somebody-else").household;
    engine.mandates.importMandate({
      id: MANDATE, household: elsewhere, ceiling_out_of_network: 1, co_signers: [],
      ceiling_daily: null, cooling_seconds: null, lapses_at: Date.now() + 3_600_000, version: 1,
    } as never);
    expect(() => engine.mandates.record({
      mandate: { id: MANDATE, household: HOUSEHOLD, ceiling_out_of_network: 1, co_signers: [], ceiling_daily: null,
        cooling_seconds: null, lapses_at: Date.now() + 3_600_000, version: 2 } as never,
      signatures: {}, assertions: {}, keyOf: () => undefined, relyingPartyId: "unit.example",
    })).toThrow(expect.objectContaining({ code: "wrong_household" }));
  });
});

describe("§16.2, question 56: an offer names a mandate this household has", () => {
  test("a label the household never recorded is refused, and one it has is not", async () => {
    // NOTE (mutation check, 2026-09-16): offer_names_any_label. The phantom
    // offer settled at once, with the household's daily ceiling of 0 and its
    // cooling window of a day both unapplied.
    //
    // Measured before the rule: a presenter naming any label after the
    // household's own prefix got an offer with no out-of-network ceiling, no
    // daily ceiling and no cooling window, having recorded nothing, imported
    // nothing and forged nothing. It is invisible to the member, because the
    // decided set's signed bytes name the offer and its candidates and not
    // the mandate.
    const { engine } = makeEngine();
    const m = {
      id: MANDATE, household: HOUSEHOLD, ceiling_out_of_network: 1_000_000,
      ceiling_daily: 0, cooling_seconds: 86_400, co_signers: [],
      lapses_at: Date.now() + 10 * HOUR, version: 1,
    };
    engine.mandates.record({
      mandate: m as never,
      signatures: { [HOUSEHOLD]: sign(null, canonicalMandate(m as never), MANDATE_PAIR.privateKey).toString("base64") },
      assertions: {}, keyOf: (k: string) => engine.publicKeyFor(k), relyingPartyId: "unit.example",
    });
    const offerFor = (mandate: string, product: string) => ({
      binding: "digital" as const, household: HOUSEHOLD, purpose: "replenish" as const,
      config_version: CONFIG_VERSION, expires_at: Date.now() + HOUR, mandate, price_band: null, giver: null,
      candidates: [{ product, quantity: 1, predicted_conversion: 0.5, is_exploration: true, given_by: null }],
    });
    const phantom = engine.createOffer(offerFor(`${HOUSEHOLD}.presenter-chose-this`, "tea-b") as never);
    await expect(engine.present(phantom.id)).rejects.toMatchObject({ code: "mandate_unknown" });
    // The household's own mandate still presents, so the refusal above is not
    // a rule that refuses everything.
    const real = engine.createOffer(offerFor(MANDATE, "tea-a") as never);
    expect((await engine.present(real.id)).state).toBe("presented");
    // And a household that has set no protection here is left alone, which is
    // every household before its first mandate.
    const stranger = houseFor("no-mandate-yet");
    const theirs = engine.createOffer({ ...offerFor(`${stranger.household}.1`, "coffee-a"), household: stranger.household } as never);
    expect((await engine.present(theirs.id)).state).toBe("presented");
  });

  test("a mandate recorded after an offer was presented still reaches it", async () => {
    // NOTE (mutation check, 2026-09-16): offer_names_any_label. The offer
    // settled, with the cooling window the household had set unapplied.
    //
    // The refusal belongs wherever the mandate is read and not at presentation
    // alone. It was at presentation alone for an hour: a presenter had only to
    // present before the household set its first protection, which is the
    // ordinary order for a new member.
    const { engine } = makeEngine();
    const offer = engine.createOffer({
      binding: "digital", household: HOUSEHOLD, purpose: "replenish",
      config_version: CONFIG_VERSION, expires_at: Date.now() + HOUR,
      mandate: `${HOUSEHOLD}.presenter-chose-this`, price_band: null, giver: null,
      candidates: [{ product: "tea-a", quantity: 1, predicted_conversion: 0.5, is_exploration: true, given_by: null }],
    } as never);
    expect((await engine.present(offer.id)).state).toBe("presented");
    const m = {
      id: MANDATE, household: HOUSEHOLD, ceiling_out_of_network: 1_000_000,
      ceiling_daily: 0, cooling_seconds: 86_400, co_signers: [],
      lapses_at: Date.now() + 10 * HOUR, version: 1,
    };
    engine.mandates.record({
      mandate: m as never,
      signatures: { [HOUSEHOLD]: sign(null, canonicalMandate(m as never), MANDATE_PAIR.privateKey).toString("base64") },
      assertions: {}, keyOf: (k: string) => engine.publicKeyFor(k), relyingPartyId: "unit.example",
    });
    const c = engine.mustGet(offer.id).candidates[0]!;
    await decideSigned(engine, offer.id, [{ candidate: c.id, valence: "kept", kept_as: "self" }] as never);
    await expect(engine.settle(offer.id, Date.now())).rejects.toMatchObject({ code: "mandate_unknown" });
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
