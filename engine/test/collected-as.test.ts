import { describe, expect, test } from "bun:test";
import { CONFIG_VERSION, HOUR, makeEngine } from "./helpers.js";
import { collectedAs } from "../src/shared/collected.js";

/**
 * §3 and §11.1, questions 48 and 49, decided 2026-09-15.
 *
 * A candidate's `collected_as` says what a collection named it, which is what
 * tells a line not in the box from one the deadline made `lost`. And a
 * physical line carries one of its product, because a collection gives a line
 * one verdict.
 */
const physical = (household: string, quantity = 1) => ({
  binding: "physical" as const,
  household,
  purpose: "replenish" as const,
  config_version: CONFIG_VERSION,
  expires_at: Date.now() + HOUR,
  mandate: "mandate-1",
  price_band: null,
  giver: null,
  candidates: ["coffee-a", "tea-b", "miso-a"].map((product, i) => ({
    product,
    quantity: i === 0 ? quantity : 1,
    predicted_conversion: 0.5,
    is_exploration: i === 0,
    given_by: null,
  })),
});

describe("§3: what a collection named each candidate (question 48)", () => {
  test("each list maps to its verdict, and nothing before a collection", async () => {
    const made = makeEngine();
    const offer = made.engine.createOffer(physical("house-q48"));
    await made.engine.present(offer.id);
    const [back, used, gone] = offer.candidates;
    expect(collectedAs(made.engine.recoveries.for(offer.id), back!.id)).toBeNull();
    made.engine.collect({
      offer: offer.id,
      returned: [back!.id],
      consumed: [used!.id],
      missing: [gone!.id],
      missing_notes: { [gone!.id]: "not in the tray" },
    });
    const row = made.engine.recoveries.for(offer.id);
    expect([back, used, gone].map((c) => collectedAs(row, c!.id))).toEqual(["returned", "consumed", "missing"]);
    expect(collectedAs(row, "not-a-candidate")).toBeNull();
    expect(collectedAs(undefined, back!.id)).toBeNull();
  });
});

describe("§11.1: a physical line carries one (question 49)", () => {
  test("a physical offer with a quantity other than one is refused, and a digital one is not", () => {
    const made = makeEngine();
    for (const quantity of [2, 0]) {
      expect(() => made.engine.createOffer(physical(`house-q49-${quantity}`, quantity))).toThrow(
        expect.objectContaining({ code: "physical_quantity" })
      );
    }
    expect(() => made.engine.createOffer({ ...physical("house-q49-digital", 2), binding: "digital" })).not.toThrow();
  });
});
