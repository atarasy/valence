import { describe, expect, test } from "bun:test";
import { canonicalConfig } from "../src/engine/offers.js";
import type { PresenterConfig } from "../src/common/types.js";
import { generateKeyPairSync, sign } from "node:crypto";
import { makeEngine, signConfig } from "./helpers.js";

/**
 * The bytes a presenter signs over its catalogue.
 *
 * **These live here rather than in the conformance suite, and the reason is a
 * measurement.** `maker_outside_the_signed_catalogue` took the maker out of
 * the signed form and the suite could not catch it: the probes talk HTTP and
 * cannot forge a catalogue signed one way and presented another, so the
 * mutation broke the seed instead of failing a probe and reported ABORTED. A
 * mutation that aborts proves nothing about a probe. The property is real, so
 * it is checked where the function can be called directly.
 */
const base: PresenterConfig = {
  version: "v-1",
  presenter: "presenter-1",
  products: {
    "tea-a": { merchant: "shop-1", maker: "made-by-tea", ships: "carrier-1", price: 1200 },
  },
};

const bytes = (c: PresenterConfig) => canonicalConfig(c).toString("utf8");

describe("the catalogue's signed bytes", () => {
  test("who made a product is inside them", () => {
    // Left outside, whoever relays a catalogue could change who made a product
    // under a signature that still verifies, and clause 12 would be answered
    // by whatever the relay chose.
    const other: PresenterConfig = {
      ...base,
      products: { "tea-a": { ...base.products["tea-a"]!, maker: "made-by-somebody-else" } },
    };
    expect(bytes(base)).not.toBe(bytes(other));
  });

  test("the merchant, the carrier, the price and the category are inside them", () => {
    const p = base.products["tea-a"]!;
    for (const over of [
      { merchant: "shop-2" },
      { ships: "carrier-2" },
      { price: 1300 },
      { category: "tea" },
    ]) {
      const other: PresenterConfig = { ...base, products: { "tea-a": { ...p, ...over } } };
      expect(bytes(other)).not.toBe(bytes(base));
    }
  });

  test("a field cannot be moved across the separator", () => {
    // Found 2026-09-12 by writing the test above. The parts were joined with
    // ":" and not escaped, so a merchant named "shop-1:made-by-tea" with an
    // empty maker made the same bytes as a merchant "shop-1" with a maker
    // "made-by-tea": whoever relays a catalogue could move the boundary
    // between who sold it and who made it, and the signature still verified.
    // The mandate's form and the edge's had both been escaped for exactly this
    // reason; the catalogue was the third place with the same defect.
    // **The pair has to keep the same number of parts**, which the first
    // version of this test did not: an empty maker still emits its separator,
    // so the two forms differed by one colon and the test passed against the
    // unescaped join it was written to catch. Measured 2026-09-12, by running
    // `catalogue_form_is_malleable` against it: the mutation survived.
    const left: PresenterConfig = {
      ...base,
      products: { "tea-a": { ...base.products["tea-a"]!, merchant: "a:b", maker: "c" } },
    };
    const right: PresenterConfig = {
      ...base,
      products: { "tea-a": { ...base.products["tea-a"]!, merchant: "a", maker: "b:c" } },
    };
    expect(bytes(left)).not.toBe(bytes(right));
  });
});

/**
 * §5.2. A catalogue is accepted only when signed by the key registered for the
 * presenter it names.
 *
 * **Proven here because no probe can reach it.** `POST /_presenter/configs` is
 * deployment plumbing the specification routes nowhere, so the conformance
 * suites have no way to publish a catalogue at all, let alone an unsigned one,
 * and the seed that does publish always signs correctly. The full sweep of
 * 2026-09-12 measured the consequence: `unsigned_catalogue` removed the
 * refusal and **survived**, the one survivor in 253 mutations, with nothing in
 * either suite failing. A rule the implementation map records as enforced was
 * enforced by code nothing tested.
 */
describe("§5.2: a catalogue carries its presenter's signature", () => {
  const catalogue = (version: string) => ({
    version,
    presenter: "merchant-1",
    products: {
      "tea-a": { merchant: "maker-a", maker: "made-by-tea", ships: "carrier-a", price: 1200 },
    },
  });

  test("an unsigned catalogue is refused", () => {
    const { engine } = makeEngine();
    expect(() => engine.registerConfig(catalogue("cfg-unsigned") as never)).toThrow(/not signed by/);
  });

  test("a catalogue signed by another key is refused", () => {
    const { engine } = makeEngine();
    const stranger = generateKeyPairSync("ed25519");
    const config = catalogue("cfg-stranger");
    const forged = sign(null, canonicalConfig(config as never), stranger.privateKey).toString("base64");
    expect(() => engine.registerConfig(config as never, forged)).toThrow(/not signed by/);
  });

  test("a catalogue signed over other bytes is refused", () => {
    const { engine } = makeEngine();
    const config = catalogue("cfg-other-bytes");
    const over = signConfig(catalogue("cfg-something-else") as never);
    expect(() => engine.registerConfig(config as never, over)).toThrow(/not signed by/);
  });

  test("the presenter's own signature is accepted", () => {
    const { engine } = makeEngine();
    const config = catalogue("cfg-good");
    expect(engine.registerConfig(config as never, signConfig(config as never)).version).toBe("cfg-good");
  });
});
