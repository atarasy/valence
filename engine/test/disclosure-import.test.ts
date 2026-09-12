import { describe, expect, test } from "bun:test";
import { makeEngine, MANDATE_PAIR, disclosureFor, CONFIG_VERSION } from "./helpers.js";
import { canonicalDecisions } from "../src/shared/decisions.js";
import { sign } from "node:crypto";

/**
 * §10a.3, the half no conformance probe reaches.
 *
 * A block this host recorded always verifies again at the decision: it was
 * checked against the merchant's key when it was recorded, and an identity
 * cannot be replaced. **The check exists for §14.2's import**, which carries
 * the blocks the sending host froze onto the offer, signed by keys this host
 * may not hold. The conformance suite cannot construct that without importing
 * an offer, so it is proven here.
 */
describe("§10a.3: an imported block signed by a key this host lacks", () => {
  test("a decision on it is refused", async () => {
    const { engine } = makeEngine();
    const offer = await engine.createOffer({
      binding: "digital",
      household: "household-1",
      purpose: "replenish",
      config_version: CONFIG_VERSION,
      expires_at: Date.now() + 3_600_000,
      mandate: "mandate-1",
      price_band: null,
      giver: null,
      candidates: [{ product: "tea-a", quantity: 1, is_exploration: true }],
    } as never);
    await engine.present(offer.id);

    // The block a sending host would have frozen on: well formed, signed by a
    // key this host has never seen.
    offer.disclosures = [{ ...disclosureFor("maker-a"), signature: "AAAA" }];

    const decisions = [{ candidate: offer.candidates[0]!.id, valence: "kept" as const, kept_as: "self" as const }];
    const signature = sign(null, canonicalDecisions(offer.id, decisions), MANDATE_PAIR.privateKey).toString("base64");
    await expect(engine.decide(offer.id, decisions, signature)).rejects.toThrow(/does not verify/);
  });
});

/**
 * §10a.5, the same half for a product block.
 *
 * A product block reaches the approval and the settlement statement as the
 * merchant's word. The check at the decision found the standing text per
 * candidate and verified that one only, so a product block an import carried,
 * signed for another product or signed by nobody, was rendered unverified.
 * Found by a refutation pass on 2026-09-12, hours after the key was added.
 */
describe("§10a.5: a product block with an invalid signature on an existing offer", () => {
  test("a decision on the offer is refused", async () => {
    const { engine } = makeEngine();
    const offer = await engine.createOffer({
      binding: "digital",
      household: "household-2",
      purpose: "replenish",
      config_version: CONFIG_VERSION,
      expires_at: Date.now() + 3_600_000,
      mandate: "mandate-1",
      price_band: null,
      giver: null,
      candidates: [{ product: "tea-a", quantity: 1, is_exploration: true }],
    } as never);
    await engine.present(offer.id);

    // The standing text verifies under the registered maker-a key. Replace
    // the product block directly with an invalid signature; this fixture
    // neither imports an offer nor removes the merchant's key.
    // In the completed original 299 mutation log reviewed 2026-09-13,
    // product_block_signature_unchecked lets this decision resolve, directly
    // failing the invalid-signature refusal assertion below. This is a unit
    // verification catch, not an HTTP import or missing-key measurement.
    offer.disclosures = [
      disclosureFor("maker-a"),
      { ...disclosureFor("maker-a", "tea-a"), signature: "AAAA" },
    ];

    const decisions = [{ candidate: offer.candidates[0]!.id, valence: "kept" as const, kept_as: "self" as const }];
    const signature = sign(null, canonicalDecisions(offer.id, decisions), MANDATE_PAIR.privateKey).toString("base64");
    await expect(engine.decide(offer.id, decisions, signature)).rejects.toThrow(/does not verify/);
  });
});
