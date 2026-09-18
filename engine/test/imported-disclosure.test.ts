import { expect, test } from "bun:test";
import { CONFIG_VERSION, HOUR, HOUSEHOLD, MANDATE, decideSigned, makeEngine } from "./helpers.js";

// §10a.3, §14.2: an import can arrive already presented, so the receiving
// engine must check disclosure completeness when the household decides.
// Measured 2026-09-13: the corrected decide_without_disclosure mutation
// resolves the refused decision and fails the rejection assertion below.
test("an imported presented offer needs its merchant disclosure before a decision", async () => {
  const { engine: sender } = makeEngine();
  const offer = sender.createOffer({
    binding: "digital", household: HOUSEHOLD, purpose: "replenish",
    config_version: CONFIG_VERSION, expires_at: Date.now() + HOUR,
    mandate: MANDATE, price_band: null, giver: null,
    candidates: [{ product: "coffee-a", quantity: 1, predicted_conversion: 0.5,
      is_exploration: true, given_by: null }],
  });
  await sender.present(offer.id);
  const decisions = offer.candidates.map((c) => ({
    candidate: c.id, valence: "kept" as const, kept_as: "self" as const,
  }));
  // §14.2, question 57, decided 2026-09-18. A move no longer carries an offer
  // that is still in progress, so the case this test was written for is
  // reached on an offer presented here rather than on one that arrived.
  const { engine: missing } = makeEngine();
  expect(() => missing.importOffer(structuredClone(offer), offer.household))
    .toThrow(expect.objectContaining({ code: "bad_state" }));

  const { engine: local } = makeEngine();
  const here = local.createOffer({
    binding: "digital", household: HOUSEHOLD, purpose: "replenish",
    config_version: CONFIG_VERSION, expires_at: Date.now() + HOUR,
    mandate: MANDATE, price_band: null, giver: null,
    candidates: [{ product: "coffee-a", quantity: 1, predicted_conversion: 0.5,
      is_exploration: true, given_by: null }],
  });
  await local.present(here.id);
  const theirs = here.candidates.map((c) => ({ candidate: c.id, valence: "kept" as const, kept_as: "self" as const }));
  // The disclosure the merchant signed, taken off the offer this host holds.
  (local.mustGet(here.id) as { disclosures: unknown[] }).disclosures = [];
  await expect(decideSigned(local, here.id, theirs)).rejects.toMatchObject({
    status: 422, code: "disclosure_missing",
  });
  expect(local.mustGet(here.id).state).toBe("presented");
  expect(local.mustGet(here.id).candidates[0]!.valence).toBe("offered");
});
