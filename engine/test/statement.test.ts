import { describe, expect, test } from "bun:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { CONFIG_VERSION, HOUR, MANDATE_PAIR, MERCHANT_PAIR, PHYSICAL, makeEngine, settleSigned, decideSigned, disclosureFor, signConfig } from "./helpers.js";
import { canonicalStatement, statementLines } from "../src/shared/statement.js";
import { canonicalDecisions } from "../src/shared/decisions.js";
import { canonicalDisclosure, verifyDisclosure } from "../src/shared/disclosure.js";

/**
 * §6.5 and §11.2. Question 36, decided 2026-09-12.
 *
 * The collection records what was used and the household may not name that
 * verdict itself; until this file existed the reference then charged those
 * lines on the collection's record alone. The collection's record is a
 * proposal, the household's signature over the statement is the application,
 * a disputed line leaves the rail, and the next box does not come while a
 * statement stands unsigned.
 */
const physical = (household: string, products: { product: string; given_by?: string }[]) => ({
  binding: "physical" as const,
  household,
  purpose: "replenish" as const,
  config_version: CONFIG_VERSION,
  expires_at: Date.now() + HOUR,
  mandate: "mandate-1",
  price_band: null,
  giver: null,
  candidates: products.map((c, i) => ({
    product: c.product,
    quantity: 1,
    predicted_conversion: 0.5,
    is_exploration: i === 0,
    given_by: c.given_by ?? null,
  })),
});

async function collected(engine: ReturnType<typeof makeEngine>["engine"], household = "house-s") {
  const offer = engine.createOffer(physical(household, [{ product: "coffee-a" }, { product: "tea-b" }, { product: "miso-a" }]));
  await engine.present(offer.id);
  engine.recoveries.collect({
    offer: offer.id,
    returned: [offer.candidates[2]!.id],
    consumed: [offer.candidates[0]!.id, offer.candidates[1]!.id],
    at: Date.now(),
  });
  engine.applyRecoveryTo(offer.id);
  return offer;
}

describe("§6.5: a physical box with goods used settles on the household's signature", () => {
  test("an empty settle is refused, and names itself", async () => {
    const { engine } = makeEngine();
    const offer = await collected(engine);
    await expect(engine.settle(offer.id)).rejects.toMatchObject({ code: "statement_unsigned" });
    expect(engine.settlement(offer.id)).toBeUndefined();
  });

  test("a signature by another key, or over other lines, is refused", async () => {
    const { engine } = makeEngine();
    const offer = await collected(engine);
    const lines = statementLines(offer, []);
    const stranger = generateKeyPairSync("ed25519");
    const forged = sign(null, canonicalStatement(offer.id, lines), stranger.privateKey).toString("base64");
    await expect(engine.settle(offer.id, Date.now(), { signed: { signature: forged } })).rejects.toMatchObject({ code: "bad_signature" });
    // The right key over a statement that disputes a line, sent without the
    // dispute: the bytes differ and the signature does not cover what is sent.
    const other = sign(null, canonicalStatement(offer.id, statementLines(offer, [offer.candidates[0]!.id])), MANDATE_PAIR.privateKey).toString("base64");
    await expect(engine.settle(offer.id, Date.now(), { signed: { signature: other } })).rejects.toMatchObject({ code: "bad_signature" });
  });

  test("the signed statement settles, and the settlement carries it", async () => {
    const { engine } = makeEngine();
    const offer = await collected(engine);
    const settlement = await settleSigned(engine, offer.id);
    expect(settlement.consumed_amount).toBe(1500 + 900);
    expect(settlement.charged).toBe(1500 + 900);
    expect(settlement.disputed_amount).toBe(0);
    expect(typeof settlement.confirmation).toBe("string");
  });

  test("a disputed line leaves the rail: not charged, and shown as disputed", async () => {
    const { engine } = makeEngine();
    const offer = await collected(engine);
    const coffee = offer.candidates[0]!.id;
    const settlement = await settleSigned(engine, offer.id, [coffee]);
    expect(settlement.consumed_amount).toBe(900);
    expect(settlement.charged).toBe(900);
    expect(settlement.disputed_amount).toBe(1500);
    const line = settlement.lines.find((l) => l.candidate === coffee)!;
    expect(line.disputed).toBe(true);
    expect(line.amount).toBe(1500);
    expect(settlement.lines.find((l) => l.product === "tea-b")!.disputed).toBe(false);
  });

  test("only a consumed line can be disputed", async () => {
    const { engine } = makeEngine();
    const offer = await collected(engine);
    const returned = offer.candidates[2]!.id;
    await expect(settleSigned(engine, offer.id, [returned])).rejects.toMatchObject({ code: "not_disputable" });
  });

  test("the digital binding and a box with nothing used need no statement", async () => {
    const { engine } = makeEngine();
    const offer = engine.createOffer(physical("house-clean", [{ product: "coffee-a" }, { product: "tea-b" }]));
    await engine.present(offer.id);
    engine.recoveries.collect({ offer: offer.id, returned: offer.candidates.map((c) => c.id), consumed: [], at: Date.now() });
    engine.applyRecoveryTo(offer.id);
    const settlement = await engine.settle(offer.id);
    expect(settlement.charged).toBe(0);
    expect(settlement.confirmation).toBeNull();
  });

  test("the next box does not come while a statement stands unsigned", async () => {
    const { engine } = makeEngine();
    const first = await collected(engine, "house-next");
    const second = engine.createOffer(physical("house-next", [{ product: "nori-a" }, { product: "coffee-a" }]));
    await expect(engine.present(second.id)).rejects.toMatchObject({ code: "statement_unsigned" });
    await settleSigned(engine, first.id);
    const presented = await engine.present(second.id);
    expect(presented.state).toBe("presented");
  });
});

describe("§10a.5: a block for one product", () => {
  test("the product is inside the signature", () => {
    const block = disclosureFor("maker-a", "tea-a");
    const pem = MERCHANT_PAIR.publicKey.export({ type: "spki", format: "pem" }).toString();
    expect(verifyDisclosure(block, pem)).toBe(true);
    expect(verifyDisclosure({ ...block, product: "tea-b" }, pem)).toBe(false);
    expect(verifyDisclosure({ ...block, product: null }, pem)).toBe(false);
    expect(canonicalDisclosure(block).equals(canonicalDisclosure({ ...block, product: null }))).toBe(false);
  });

  test("it travels only on an offer holding that product, beside the standing text", async () => {
    const { engine } = makeEngine();
    engine.putDisclosure(disclosureFor("maker-a", "tea-a"));
    const withTea = engine.createOffer(physical("house-p", [{ product: "tea-a" }, { product: "tea-b" }]));
    expect(withTea.disclosures.map((d) => d.product).sort()).toEqual([null, "tea-a"].sort());
    const without = engine.createOffer(physical("house-q", [{ product: "coffee-a" }, { product: "tea-b" }]));
    expect(without.disclosures.map((d) => d.product)).toEqual([null]);
  });

  test("it does not stand in for the merchant's standing text", async () => {
    const { engine } = makeEngine();
    engine.registerIdentity("maker-b", MERCHANT_PAIR.publicKey.export({ type: "spki", format: "pem" }).toString());
    const config = {
      version: "cfg-b",
      presenter: "merchant-1",
      products: {
        "salt-a": { merchant: "maker-b", maker: "made-by-salt", ships: "carrier-b", price: 500, physical: PHYSICAL },
      },
    };
    engine.registerConfig(config, signConfig(config));
    // Only a product block for maker-b. §10a.3 asks for the standing text,
    // and a block about one product is not it.
    engine.putDisclosure(disclosureFor("maker-b", "salt-a"));
    const offer = engine.createOffer({ ...physical("house-b", [{ product: "salt-a" }]), config_version: "cfg-b" });
    await expect(engine.present(offer.id)).rejects.toMatchObject({ code: "disclosure_missing" });
    engine.putDisclosure(disclosureFor("maker-b"));
    const again = engine.createOffer({ ...physical("house-b2", [{ product: "salt-a" }]), config_version: "cfg-b" });
    expect((await engine.present(again.id)).state).toBe("presented");
  });
});

describe("§16.5 and §11.2: the cooling window takes back what the person signed, and nothing else", () => {
  /**
   * The hole this closes was found by a refutation pass on 2026-09-12, hours
   * after §6.5 was written to close the same hole from the other side. A
   * physical offer reaches `decided` when the collection resolves its last
   * candidate, and `withdrawDecisions` reset **every** candidate to `offered`.
   * The household then signed `returned` over goods it had eaten, `settle`
   * found no `consumed` line, asked for no statement, and charged nothing. The
   * receipt said the goods came back unopened.
   */
  const cooling = (seconds: number | null) => ({
    async get() {
      return {
        id: "mandate-1",
        household: "house-s",
        ceiling_out_of_network: 1_000_000,
        ceiling_daily: null,
        cooling_seconds: seconds,
        co_signers: [],
        lapses_at: Date.now() + 86_400_000,
        version: 1,
      } as never;
    },
  });

  test("a candidate the collection resolved is not reset, and cannot be re-signed", async () => {
    const { engine } = makeEngine();
    engine.readMandatesFrom(cooling(3600));
    const offer = await collected(engine);
    const [coffee, tea, nori] = offer.candidates;
    const taken = await engine.withdrawDecisions(offer.id);
    // The collection's two verdicts stand; the third, which the collection
    // returned, stands too. There is nothing here the household signed.
    expect(taken.candidates.find((c) => c.id === coffee!.id)!.valence).toBe("consumed");
    expect(taken.candidates.find((c) => c.id === tea!.id)!.valence).toBe("consumed");
    expect(taken.candidates.find((c) => c.id === nori!.id)!.valence).toBe("returned");
    // And the household cannot sign over them: `consumed` and `lost` are
    // refused as decisions, and `returned` over a consumed candidate would be
    // the household naming the verdict, which §11.2 forbids.
    await expect(
      decideSigned(engine, offer.id, [{ candidate: coffee!.id, valence: "returned" }])
    ).rejects.toMatchObject({ status: 409 });
  });

  test("what the household signed is still taken back", async () => {
    const { engine } = makeEngine();
    engine.readMandatesFrom(cooling(3600));
    const offer = engine.createOffer(physical("house-mix", [{ product: "coffee-a" }, { product: "tea-b" }, { product: "miso-a" }]));
    await engine.present(offer.id);
    await decideSigned(engine, offer.id, offer.candidates.map((c) => ({ candidate: c.id, valence: "kept" as const, kept_as: "self" as const })));
    const taken = await engine.withdrawDecisions(offer.id);
    for (const c of taken.candidates) expect(c.valence).toBe("offered");
  });

  test("a used box still settles only on the signature after the window", async () => {
    const { engine } = makeEngine();
    engine.readMandatesFrom(cooling(null));
    const offer = await collected(engine);
    await expect(engine.settle(offer.id)).rejects.toMatchObject({ code: "statement_unsigned" });
  });
});

describe("§6.5: the block is a pressure the household can lift, and nobody else can make permanent", () => {
  test("a withdrawn box does not block the next one", async () => {
    // A presenter that collects part of a box and then withdraws it leaves an
    // offer that can never be settled. Counting it blocked that household's
    // every future physical box, from every presenter, for good.
    const { engine } = makeEngine();
    const first = engine.createOffer(physical("house-w", [{ product: "coffee-a" }, { product: "tea-b" }, { product: "miso-a" }]));
    await engine.present(first.id);
    engine.recoveries.collect({ offer: first.id, returned: [], consumed: [first.candidates[0]!.id], at: Date.now() });
    engine.applyRecoveryTo(first.id);
    await engine.withdraw(first.id);
    const second = engine.createOffer(physical("house-w", [{ product: "nori-a" }, { product: "coffee-a" }]));
    expect((await engine.present(second.id)).state).toBe("presented");
  });

  test("a box the household cannot yet settle does not block the next one", async () => {
    // A partial collection leaves the offer `presented`, where `settle` is a
    // 409. A block counting it is one the household is forbidden to cure.
    const { engine } = makeEngine();
    const first = engine.createOffer(physical("house-p2", [{ product: "coffee-a" }, { product: "tea-b" }, { product: "miso-a" }]));
    await engine.present(first.id);
    engine.recoveries.collect({ offer: first.id, returned: [], consumed: [first.candidates[0]!.id], at: Date.now() });
    engine.applyRecoveryTo(first.id);
    expect(engine.mustGet(first.id).state).toBe("presented");
    await expect(engine.settle(first.id)).rejects.toMatchObject({ status: 409 });
    const second = engine.createOffer(physical("house-p2", [{ product: "nori-a" }, { product: "coffee-a" }]));
    expect((await engine.present(second.id)).state).toBe("presented");
  });

  test("the refusal names no other offer", async () => {
    const { engine } = makeEngine();
    const first = await collected(engine, "house-quiet");
    const second = engine.createOffer(physical("house-quiet", [{ product: "nori-a" }, { product: "coffee-a" }]));
    await expect(engine.present(second.id)).rejects.toMatchObject({ code: "statement_unsigned" });
    try {
      await engine.present(second.id);
    } catch (err) {
      expect((err as Error).message).not.toContain(first.id);
    }
  });
});

describe("§6.5: the statement's bytes are its own", () => {
  test("a decided set's signature does not verify as a statement", async () => {
    const { engine } = makeEngine();
    const offer = await collected(engine, "house-tag");
    const lines = statementLines(engine.mustGet(offer.id), []);
    const asDecisions = canonicalDecisions(
      offer.id,
      lines.map((l) => ({ candidate: l.candidate, valence: l.valence as never }))
    );
    expect(canonicalStatement(offer.id, lines).equals(asDecisions)).toBe(false);
    expect(canonicalStatement(offer.id, lines).toString("utf8").startsWith("valence.statement.1\n")).toBe(true);
  });
});
