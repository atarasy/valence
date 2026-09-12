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
