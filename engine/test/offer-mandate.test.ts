import { describe, expect, test } from "bun:test";
import { CONFIG_VERSION, HOUR, HOUSEHOLD, MANDATE, houseFor, makeEngine } from "./helpers.js";
import type { Offer } from "../src/common/types.js";

/**
 * §16, question 54, decided 2026-09-16. The mandate an offer reads is its own
 * household's. An offer named a mandate id and read its ceilings, its cooling
 * window and its co-signers through it, whoever they belonged to.
 *
 * **Question 55 then made the binding a property of the identifier** (§13.2,
 * 2026-09-16): a mandate identifier begins with its household's, so an offer
 * naming another household's mandate is refused where it is created and where
 * it arrives. The runtime check stays, and the second test below is what keeps
 * it from being a guard nothing reaches: this project has shipped one of those
 * and paid a whole sweep to find out.
 */
describe("§16, question 54: the mandate an offer reads is its own household's", () => {
  const ELSEWHERE = houseFor("somebody-else");
  const lapsed = {
    async get(_id?: string) {
      return {
        id: MANDATE, household: HOUSEHOLD, ceiling_out_of_network: 0,
        ceiling_daily: null, cooling_seconds: null, co_signers: [], lapses_at: 1, version: 1,
      } as never;
    },
    async dailyCeilingOf(h: string) {
      // Question 60 read this for a gift's giver alone, which these stubs
      // never are. Question 68 reads it for a household's own offers too, so
      // the stub answers from the one mandate it holds.
      const m = (await this.get("")) as { household?: string; ceiling_daily?: number | null } | undefined;
      return m?.household === h ? m.ceiling_daily ?? null : null;
    },
    // Question 68, decided 2026-09-19. A household's own offers read the
    // tightest across every mandate it holds. These stubs hold one, so the
    // tightest is that one where it is this household's.
    async outOfNetworkCeilingOf(h: string) {
      const m = (await this.get("")) as { household?: string; ceiling_out_of_network?: number } | undefined;
      return m?.household === h ? m.ceiling_out_of_network ?? null : null;
    },
    async coolingSecondsOf(h: string) {
      const m = (await this.get("")) as { household?: string; cooling_seconds?: number | null } | undefined;
      return m?.household === h ? m.cooling_seconds ?? null : null;
    },
    async holdsAny(h: string) {
      // §16.2, question 56. A stub that answers with a mandate must also say
      // whose it is, or an offer of that household naming another label is
      // refused before the stub is read.
      const m = (await this.get("")) as { household?: string } | undefined;
      return m?.household === h;
    },
  };
  const offerFor = (household: string, mandate: string) => ({
    binding: "digital" as const, household, purpose: "replenish" as const, config_version: CONFIG_VERSION,
    expires_at: Date.now() + HOUR, mandate, price_band: null, giver: null,
    candidates: [{ product: "tea-a", quantity: 1, predicted_conversion: 0.5, is_exploration: true, given_by: null }],
  });

  test("an offer cannot name another household's mandate at all", async () => {
    // NOTE (mutation check, 2026-09-16): offer_mandate_shape_unchecked.
    // §13.2, question 55. The defect question 54 closed is now unreachable
    // through this route: the identifier carries the household.
    const { engine } = makeEngine();
    expect(() => engine.createOffer(offerFor(ELSEWHERE.household, MANDATE) as never))
      .toThrow(expect.objectContaining({ code: "name_is_not_the_key" }));
    expect(() => engine.createOffer(offerFor(HOUSEHOLD, ELSEWHERE.mandate) as never))
      .toThrow(expect.objectContaining({ code: "name_is_not_the_key" }));
  });

  test("a mandate of another household is no mandate here, and still binds its own", async () => {
    // NOTE (mutation check, 2026-09-16): offer_reads_any_mandate. The first
    // offer is refused with `mandate_lapsed` by a mandate that belongs to
    // somebody else. §16.2 leaves an unknown mandate alone, and another
    // household's mandate is unknown to this offer. The second half shows the
    // same mandate is read at all, so the first half is not passing because
    // nothing was.
    //
    // The first offer is made for this household and then re-homed in place,
    // because §13.2 refuses to create it and refuses to import it. What is
    // left is a row a host running the older rule would hold.
    const { engine } = makeEngine();
    engine.readMandatesFrom(lapsed);
    const elsewhere = engine.createOffer(offerFor(HOUSEHOLD, MANDATE) as never);
    (engine as unknown as { offers: Map<string, Offer> }).offers.get(elsewhere.id)!.household = ELSEWHERE.household;
    expect((await engine.present(elsewhere.id)).state).toBe("presented");
    const own = engine.createOffer(offerFor(HOUSEHOLD, MANDATE) as never);
    await expect(engine.present(own.id)).rejects.toMatchObject({ code: "mandate_lapsed" });
  });
});
