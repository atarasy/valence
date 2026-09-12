import { describe, expect, test } from "bun:test";
import { canonicalConfig } from "../src/engine/offers.js";
import type { PresenterConfig } from "../src/common/types.js";

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
