import { describe, expect, test } from "bun:test";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { CONFIG_VERSION, HOUR, HOUSEHOLD, MANDATE, MANDATE_PAIR, decideSigned, houseFor, makeEngine } from "./helpers.js";
import { canonicalMandate } from "../src/hub/mandates.js";
import { householdOfMandate, isHouseholdName, nameOf } from "../src/common/names.js";
import { createApp } from "../src/http.js";
import { exportNode } from "../src/hub/node.js";
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
    // A claim is inert and an identifier that carries a household is that
    // household's, so the row a host running the older rule holds is a
    // **mandate** and is planted as one: there is no route that writes it.
    (engine.mandates as unknown as { rows: Map<string, unknown> }).rows.set(MANDATE, {
      id: MANDATE, household: elsewhere, ceiling_out_of_network: 1, co_signers: [],
      ceiling_daily: null, cooling_seconds: null, lapses_at: Date.now() + 3_600_000, version: 1,
    });
    expect(() => engine.mandates.record({
      mandate: { id: MANDATE, household: HOUSEHOLD, ceiling_out_of_network: 1, co_signers: [], ceiling_daily: null,
        cooling_seconds: null, lapses_at: Date.now() + 3_600_000, version: 2 } as never,
      signatures: {}, assertions: {}, keyOf: () => undefined, relyingPartyId: "unit.example",
    })).toThrow(expect.objectContaining({ code: "wrong_household" }));
  });
});

describe("§14.2, question 57: a move carries what happened", () => {
  const arriving = (over: Record<string, unknown> = {}) => ({
    id: "o-q57", household: HOUSEHOLD, mandate: MANDATE, state: "decided",
    purpose: "replenish", binding: "digital", config_version: CONFIG_VERSION,
    expires_at: Date.now() + HOUR, presenter: "merchant-1", price_band: null, giver: null,
    disclosures: [{ merchant: "maker-a", product: null, version: "d-1" }],
    candidates: [{ id: "c-q57", product: "tea-a", quantity: 1, unit_price: 1200, merchant: "maker-a",
      maker: "made-by-tea", ships: "carrier-a", category: null, predicted_conversion: 0.5,
      is_exploration: true, given_by: null, valence: "kept" }],
    ...over,
  });

  test("an offer still in progress is refused, because this ledger holds no reserve for it", () => {
    // NOTE (mutation check, 2026-09-18): import_takes_an_offer_in_progress.
    // Measured the day it was decided: the import took an offer at
    // `presented` with a 201 and no reservation on the receiving ledger.
    // §6.4 makes the reserve the upper bound of what an offer may settle at,
    // so an offer that can still be decided and has no reserve is one whose
    // upper bound this ledger has never seen. What stops it charging is
    // `commit` refusing `no_reservation`, which is the ledger's answer and
    // not this specification's.
    const { engine } = makeEngine();
    for (const state of ["drafted", "presented"]) {
      expect(() => engine.importOffer(arriving({ state }) as never, HOUSEHOLD))
        .toThrow(expect.objectContaining({ code: "bad_state" }));
    }
    // What happened still travels.
    engine.importOffer(arriving() as never, HOUSEHOLD);
    expect(engine.mustGet("o-q57").state).toBe("decided");
  });

  test("a candidate that arrives with no verdict is refused", () => {
    // NOTE (mutation check, 2026-09-18): import_candidate_without_a_verdict.
    // `decide` reads a candidate whose valence is not `offered` as one already
    // decided, so a candidate arriving with none could never be decided and
    // its line settled at nothing. Measured on a body the shape check took.
    const { engine } = makeEngine();
    const withNone = arriving();
    delete (withNone.candidates[0] as { valence?: unknown }).valence;
    expect(() => engine.importOffer(withNone as never, HOUSEHOLD))
      .toThrow(expect.objectContaining({ code: "malformed" }));
  });
});

describe("§14.2, question 56: a mandate that arrives by a move is a claim", () => {
  const terms = (over: Record<string, unknown> = {}) => ({
    id: MANDATE, household: HOUSEHOLD, ceiling_out_of_network: 1_000_000, ceiling_daily: null,
    cooling_seconds: null, co_signers: [], lapses_at: Date.now() + 10 * HOUR, version: 1, ...over,
  });
  const offerFor = (mandate: string, product: string, household = HOUSEHOLD) => ({
    binding: "digital" as const, household, purpose: "replenish" as const,
    config_version: CONFIG_VERSION, expires_at: Date.now() + HOUR, mandate, price_band: null, giver: null,
    candidates: [{ product, quantity: 1, predicted_conversion: 0.5, is_exploration: true, given_by: null }],
  });
  const signedBy = (m: ReturnType<typeof terms>) => ({
    mandate: m as never,
    signatures: { [HOUSEHOLD]: sign(null, canonicalMandate(m as never), MANDATE_PAIR.privateKey).toString("base64") },
    assertions: {}, keyOf: (k: string) => undefined as string | undefined, relyingPartyId: "unit.example",
  });

  test("a claim does nothing at all, and the household that has not signed has set nothing here", async () => {
    // NOTE (mutation check, 2026-09-18): claim_is_held_for_the_household. A
    // claim counted as a mandate this household held, so that a move would
    // fail closed, and a refutation pass measured what that bought: **one
    // unsigned POST froze any household on the host**, including one that held
    // no mandate at all and had never moved. Every offer naming any label was
    // refused, a settlement already decided could not be paid, and nothing
    // removed a claim.
    const { engine } = makeEngine();
    engine.mandates.importMandate(terms() as never);
    expect(engine.mandates.get(MANDATE)).toBeUndefined();
    expect(engine.mandates.claimFor(MANDATE)).toMatchObject({ ceiling_out_of_network: 1_000_000 });
    // It is the household's to read and to sign, and nothing else reads it.
    expect(engine.mandates.claimsFor(HOUSEHOLD).map((m) => m.id)).toEqual([MANDATE]);
    expect(engine.mandates.forHousehold(HOUSEHOLD)).toEqual([]);
    // So the household is one that has set no protection here, which is what
    // §16.2 already says of every household before its first mandate.
    const named = engine.createOffer(offerFor(MANDATE, "tea-a") as never);
    expect((await engine.present(named.id)).state).toBe("presented");
  });

  test("a claim that has already lapsed is not kept", () => {
    // NOTE (mutation check, 2026-09-18): import_keeps_a_lapsed_claim. A claim
    // that can never be signed is a row nobody can act on, and the import
    // route's own shape check admits `lapses_at: 0` where `record` refuses it.
    const { engine } = makeEngine();
    engine.mandates.importMandate(terms({ lapses_at: 0 }) as never);
    expect(engine.mandates.claimFor(MANDATE)).toBeUndefined();
  });

  test("signing the claim itself records it at the version it carries", async () => {
    // NOTE (mutation check, 2026-09-18): record_ignores_the_claims_version.
    const { engine } = makeEngine();
    engine.mandates.importMandate(terms({ version: 3 }) as never);
    const keyOf = (k: string) => engine.publicKeyFor(k);
    engine.mandates.record({ ...signedBy(terms({ version: 3 })), keyOf });
    expect(engine.mandates.get(MANDATE)).toMatchObject({ version: 3 });
    expect(engine.mandates.claimFor(MANDATE)).toBeUndefined();
    const named = engine.createOffer(offerFor(MANDATE, "tea-a") as never);
    expect((await engine.present(named.id)).state).toBe("presented");
  });

  test("a claim is an offer to sign and never a constraint", () => {
    // NOTE (mutation check, 2026-09-18): record_takes_the_claims_version_alone.
    // Checking the version and not the terms let a household record **its own**
    // terms at the claim's version, which dropped the co-signers it had named
    // where it came from: clause 47 escaped by relocation, measured 2026-09-18.
    // Binding the claim's terms instead would let a planted row with a
    // co-signer nobody holds freeze that identifier for ever, which is what
    // question 56's first attempt was refused for. So the claim counts only
    // when what is submitted is the claim itself.
    const { engine } = makeEngine();
    const co = houseFor("mum").household;
    engine.mandates.importMandate(terms({ version: 3, co_signers: [co] }) as never);
    const keyOf = (k: string) => engine.publicKeyFor(k);
    // Anything but the claim is an ordinary record, judged against what this
    // host holds, which is a claim and not a signed history: so the household
    // says which version it is at, and the co-signers the claim named do not
    // bind it. Requiring version 1 here made a stranger's claim cost the
    // household its version line, measured by a refutation pass 2026-09-18.
    engine.mandates.record({ ...signedBy(terms({ version: 3, co_signers: [] })), keyOf });
    expect(engine.mandates.get(MANDATE)).toMatchObject({ version: 3, co_signers: [] });
    // And the claim is gone, because the identifier now holds a mandate.
    expect(engine.mandates.claimFor(MANDATE)).toBeUndefined();

    // And with nothing held at all, a mandate still starts at version 1.
    const fresh = makeEngine().engine;
    expect(() => fresh.mandates.record({ ...signedBy(terms({ version: 3 })), keyOf: (k: string) => fresh.publicKeyFor(k) }))
      .toThrow(expect.objectContaining({ code: "stale_version" }));
  });

  test("the export carries the claims beside the signed rows", () => {
    // NOTE (mutation check, 2026-09-18): export_drops_claims. An offer that
    // moved with its mandate names a mandate the next archive would not carry,
    // which makes that archive invalid, and the record of what the household
    // had would stop at the first host it left. The MUST had no test at all
    // until a refutation pass measured that deleting the line changed nothing.
    const { engine } = makeEngine();
    engine.mandates.importMandate(terms() as never);
    const exported = exportNode(engine, new RecoveryRegister(), new PermissionLedger(),
      engine.mandates, new DeliveryRegister(), HOUSEHOLD);
    expect(exported.mandates.map((m) => m.id)).toEqual([MANDATE]);
  });

  test("a claim that lapses after it arrives is not one this host offers", () => {
    // NOTE (mutation check, 2026-09-18): claim_outlives_its_lapse. A claim can
    // only be signed while it is live, because `record` refuses a lapsed
    // mandate, and nothing removed one that died after it was written. The
    // acceptance flow writes a claim with a week's fuse, and a household that
    // approved late was locked out for good. **No attacker, only a week.**
    const { engine } = makeEngine();
    const soon = Date.now() + 50;
    engine.mandates.importMandate(terms({ lapses_at: soon }) as never);
    expect(engine.mandates.claimFor(MANDATE)).toBeDefined();
    expect(engine.mandates.claimFor(MANDATE, soon + 1)).toBeUndefined();
    expect(engine.mandates.claimsFor(HOUSEHOLD, soon + 1)).toEqual([]);
    // And the identifier is free again, so a live claim can take its place.
    engine.mandates.importMandate(terms({ ceiling_out_of_network: 7 }) as never, soon + 1);
    expect(engine.mandates.claimFor(MANDATE, soon + 2)).toMatchObject({ ceiling_out_of_network: 7 });
  });

  test("a version with no room to follow it is refused", () => {
    // NOTE (mutation check, 2026-09-18): version_ceiling_unchecked. At 2^53
    // `before.version + 1 === before.version`, so the version stops rising and
    // the property the canonical bytes rest on fails: a household tightened a
    // ceiling at that number and its own earlier submission replayed the loose
    // one back. Measured 2026-09-18.
    const { engine } = makeEngine();
    const keyOf = (k: string) => engine.publicKeyFor(k);
    // A claim carries the version, so signing one is the route by which such a
    // number would otherwise reach a record: the claim is what makes the case
    // reachable at all.
    for (const version of [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1, 0, 1.5]) {
      const fresh = makeEngine().engine;
      fresh.mandates.importMandate(terms({ version }) as never);
      expect(() => fresh.mandates.record({ ...signedBy(terms({ version })), keyOf: (k: string) => fresh.publicKeyFor(k) }))
        .toThrow(expect.objectContaining({ code: "stale_version" }));
    }
    expect(engine.mandates.get(MANDATE)).toBeUndefined();
  });

  test("a claim signed by anything but the household's own key is refused", () => {
    // The claim is a stranger's to write and the household's alone to sign,
    // which is the whole of what question 56's second half decides.
    const { engine } = makeEngine();
    engine.mandates.importMandate(terms() as never);
    const stranger = generateKeyPairSync("ed25519");
    const m = terms();
    expect(() => engine.mandates.record({
      mandate: m as never,
      signatures: { [HOUSEHOLD]: sign(null, canonicalMandate(m as never), stranger.privateKey).toString("base64") },
      assertions: {}, keyOf: (k: string) => engine.publicKeyFor(k), relyingPartyId: "unit.example",
    })).toThrow(expect.objectContaining({ code: "bad_signature" }));
    expect(engine.mandates.get(MANDATE)).toBeUndefined();
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
