import { expect, test } from "bun:test";
import { CONFIG_VERSION, HOUR, makeEngine, decideSigned } from "./helpers.js";

// §10a.3, §14.2: an import can arrive already presented, so the receiving
// engine must check disclosure completeness when the household decides.
// Measured 2026-09-13: the corrected decide_without_disclosure mutation
// resolves the refused decision and fails the rejection assertion below.
test("an imported presented offer needs its merchant disclosure before a decision", async () => {
  const { engine: sender } = makeEngine();
  const offer = sender.createOffer({
    binding: "digital", household: "house-import-disclosure", purpose: "replenish",
    config_version: CONFIG_VERSION, expires_at: Date.now() + HOUR,
    mandate: "mandate-1", price_band: null, giver: null,
    candidates: [{ product: "coffee-a", quantity: 1, predicted_conversion: 0.5,
      is_exploration: true, given_by: null }],
  });
  await sender.present(offer.id);
  const decisions = offer.candidates.map((c) => ({
    candidate: c.id, valence: "kept" as const, kept_as: "self" as const,
  }));
  const { engine: missing } = makeEngine();
  missing.importOffer({ ...structuredClone(offer), disclosures: [] }, offer.household);
  await expect(decideSigned(missing, offer.id, decisions)).rejects.toMatchObject({
    status: 422, code: "disclosure_missing",
  });
  expect(missing.mustGet(offer.id).state).toBe("presented");
  expect(missing.mustGet(offer.id).candidates[0]!.valence).toBe("offered");

  const { engine: complete } = makeEngine();
  complete.importOffer(structuredClone(offer), offer.household);
  await decideSigned(complete, offer.id, decisions);
  expect(complete.mustGet(offer.id).state).toBe("decided");
});
