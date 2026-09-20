import { describe, expect, test } from "bun:test";
import { CONFIG_VERSION, HOUR, HOUSEHOLD, MANDATE, makeEngine } from "./helpers.js";
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
  mandate: MANDATE,
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
    const offer = made.engine.createOffer(physical(HOUSEHOLD));
    await made.engine.present(offer.id);
    const [back, used, gone] = offer.candidates;
    expect(collectedAs(made.engine.recoveries.for(offer.id), back!.id)).toBeNull();
    await made.engine.collect({
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

  test("a row collected before question 46 has no missing list, and reads without failing", () => {
    const legacy = { offer: "o", due_at: 1, grace_days: 3, collected_at: 2, returned: ["a"], consumed: ["b"] } as unknown as Parameters<typeof collectedAs>[0];
    expect([collectedAs(legacy, "a"), collectedAs(legacy, "b"), collectedAs(legacy, "c")]).toEqual(["returned", "consumed", null]);
  });
});

describe("a recovery row stored before question 46", () => {
  test("reads with empty missing lists, so the offer view and the next box's hold check do not fail", async () => {
    const made = makeEngine();
    const offer = made.engine.createOffer(physical(HOUSEHOLD));
    await made.engine.present(offer.id);
    made.deliveries.record({ offer: offer.id, carriage: 550, code: `dc-${offer.id.slice(0, 8)}`, status: "delivered" });
    await made.engine.collect({ offer: offer.id, returned: offer.candidates.map((c) => c.id), consumed: [] });
    const rows = (made.engine.recoveries as unknown as { rows: Map<string, Record<string, unknown>> }).rows;
    const { missing: _m, missing_notes: _n, ...legacy } = rows.get(offer.id)!;
    rows.set(offer.id, legacy);
    const read = made.engine.recoveries.for(offer.id)!;
    expect([read.missing, read.missing_notes]).toEqual([[], {}]);
    const next = made.engine.createOffer({ ...physical(HOUSEHOLD), candidates: ["nori-a", "tea-a"].map((product, i) => ({ product, quantity: 1, predicted_conversion: 0.5, is_exploration: i === 0, given_by: null })) });
    await expect(made.engine.present(next.id)).resolves.toMatchObject({ state: "presented" });
  });
});

describe("§11.1: a physical line carries one (question 49)", () => {
  test("a physical offer with a quantity other than one is refused, and a digital one is not", () => {
    const made = makeEngine();
    for (const quantity of [2, 0]) {
      expect(() => made.engine.createOffer(physical(HOUSEHOLD, quantity))).toThrow(
        expect.objectContaining({ code: "physical_quantity" })
      );
    }
    expect(() => made.engine.createOffer({ ...physical(HOUSEHOLD, 2), binding: "digital" })).not.toThrow();
  });
});
