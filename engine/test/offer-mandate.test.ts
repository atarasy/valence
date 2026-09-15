import { describe, expect, test } from "bun:test";
import { CONFIG_VERSION, HOUR, makeEngine } from "./helpers.js";

/**
 * §16, question 54, decided 2026-09-16. The mandate an offer reads is its own
 * household's. An offer named a mandate id and read its ceilings, its cooling
 * window and its co-signers through it, whoever they belonged to.
 */
describe("§16, question 54: the mandate an offer reads is its own household's", () => {
  const lapsed = {
    async get() {
      return {
        id: "mandate-1", household: "owner", ceiling_out_of_network: 0,
        ceiling_daily: null, cooling_seconds: null, co_signers: [], lapses_at: 1, version: 1,
      } as never;
    },
  };
  const offerFor = (household: string) => ({
    binding: "digital" as const, household, purpose: "replenish" as const, config_version: CONFIG_VERSION,
    expires_at: Date.now() + HOUR, mandate: "mandate-1", price_band: null, giver: null,
    candidates: [{ product: "tea-a", quantity: 1, predicted_conversion: 0.5, is_exploration: true, given_by: null }],
  });

  test("a mandate of another household is no mandate here, and still binds its own", async () => {
    // NOTE (mutation check, 2026-09-16): offer_reads_any_mandate. The first
    // offer was refused with `mandate_lapsed` by a mandate that belongs to
    // somebody else. §16.2 leaves an unknown mandate alone, and another
    // household's mandate is unknown to this offer. The second half shows the
    // same mandate is read at all, so the first half is not passing because
    // nothing was.
    const { engine } = makeEngine();
    engine.readMandatesFrom(lapsed);
    const elsewhere = engine.createOffer(offerFor("somebody-else") as never);
    expect((await engine.present(elsewhere.id)).state).toBe("presented");
    const own = engine.createOffer(offerFor("owner") as never);
    await expect(engine.present(own.id)).rejects.toMatchObject({ code: "mandate_lapsed" });
  });
});
