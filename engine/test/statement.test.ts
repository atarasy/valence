import { describe, expect, test } from "bun:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { CONFIG_VERSION, HOUR, MANDATE_PAIR, MERCHANT_PAIR, PHYSICAL, makeEngine, settleSigned, disclosureFor, signConfig } from "./helpers.js";
import { canonicalStatement, statementLines } from "../src/shared/statement.js";
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
