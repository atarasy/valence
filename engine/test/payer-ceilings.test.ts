import { describe, expect, test } from "bun:test";
import { CONFIG_VERSION, GIFT_GIVER, HOUR, HOUSEHOLD, MANDATE, decideSigned, makeEngine, presentGift } from "./helpers.js";

/**
 * Clause 46, §12, question 65, decided 2026-09-19. The out-of-network ceiling
 * is the payer's. A gift charges its giver and the ceiling was read from the
 * recipient's mandate: the third refutation pass over question 64 measured a
 * gift the recipient pays nothing for refused on the recipient's ceiling of 0,
 * and one charging a giver with a ceiling of 0 presented at 1,200.
 */
describe("clause 46, question 65: a gift is held to the giver's out-of-network ceiling", () => {
  const setup = (recipient: number, giver: number | null) => {
    const { engine, ledger } = makeEngine({ isInNetwork: () => false });
    engine.readMandatesFrom({
      async get() {
        return { id: MANDATE, household: HOUSEHOLD, ceiling_out_of_network: recipient, ceiling_daily: null,
          cooling_seconds: null, co_signers: [], lapses_at: Date.now() + HOUR, version: 1 } as never;
      },
      async dailyCeilingOf() { return null; },
      async outOfNetworkCeilingOf(h: string) {
        // Question 68: the recipient's own offers read the recipient's
        // tightest, which here is the one mandate this stub holds.
        return h === GIFT_GIVER.household ? giver : h === HOUSEHOLD ? recipient : null;
      },
      async coolingSecondsOf() { return null; },
      async holdsAny(h: string) { return h === HOUSEHOLD; },
    });
    return { engine, ledger };
  };
  const gift = (engine: ReturnType<typeof makeEngine>["engine"]) => engine.createOffer({
    binding: "digital", household: HOUSEHOLD, purpose: "ceremonial", config_version: CONFIG_VERSION,
    expires_at: Date.now() + HOUR, mandate: MANDATE, price_band: { min: 0, max: 1_000_000 }, giver: GIFT_GIVER.household,
    candidates: [{ product: "tea-a", quantity: 1, predicted_conversion: 0.5, is_exploration: true, given_by: null }],
  } as never);

  test("the recipient's ceiling does not refuse a gift it pays nothing for", async () => {
    // NOTE (mutation check, 2026-09-19): gift_out_of_network_is_the_recipients.
    // The gift was refused `mandate_ceiling_out_of_network` on the recipient's 0.
    const { engine } = setup(0, 100_000);
    expect((await presentGift(engine, gift(engine).id)).state).toBe("presented");
  });

  test("the giver's ceiling refuses a gift that would pass it, and nothing is held", async () => {
    const { engine, ledger } = setup(100_000, 0);
    const offer = gift(engine);
    await expect(presentGift(engine, offer.id)).rejects.toMatchObject({ code: "mandate_ceiling_out_of_network" });
    expect(ledger.get(offer.id)).toBeUndefined();
  });

  test("a giver with no mandate sets no ceiling, and the recipient's own offers keep theirs", async () => {
    const { engine } = setup(0, null);
    expect((await presentGift(engine, gift(engine).id)).state).toBe("presented");
    const own = engine.createOffer({
      binding: "digital", household: HOUSEHOLD, purpose: "replenish", config_version: CONFIG_VERSION,
      expires_at: Date.now() + HOUR, mandate: MANDATE, price_band: null, giver: null,
      candidates: [{ product: "tea-b", quantity: 1, predicted_conversion: 0.5, is_exploration: true, given_by: null }],
    } as never);
    await expect(engine.present(own.id)).rejects.toMatchObject({ code: "mandate_ceiling_out_of_network" });
  });
});

describe("§16.3, question 66: the day is told once for each settlement, and one payer settles at a time", () => {
  const withDay = (ceiling: number, delay: number, failFirst = false) => {
    const { engine } = makeEngine();
    engine.readMandatesFrom({
      async get() {
        return { id: MANDATE, household: HOUSEHOLD, ceiling_out_of_network: 1_000_000, ceiling_daily: ceiling,
          cooling_seconds: null, co_signers: [], lapses_at: Date.now() + HOUR, version: 1 } as never;
      },
      async dailyCeilingOf(h: string) {
        // Question 68: a household's own settlement reads its tightest daily
        // ceiling, which here is the one mandate this stub holds.
        return h === HOUSEHOLD ? ceiling : null;
      },
      async outOfNetworkCeilingOf() { return null; },
      async coolingSecondsOf() { return null; },
      async holdsAny(h: string) { return h === HOUSEHOLD; },
    });
    const rows = new Map<string, number>();
    let fail = failFirst;
    const wait = () => new Promise((r) => setTimeout(r, delay));
    engine.readTheDayFrom({
      async totalSince() { await wait(); return [...rows.values()].reduce((a, b) => a + b, 0); },
      async report(row: { offer: string; amount: number }) {
        await wait();
        if (fail) { fail = false; throw new Error("hub down"); }
        rows.set(row.offer, row.amount);
      },
      async reportOffer() {},
    } as never);
    return { engine, rows };
  };
  const decided = async (engine: ReturnType<typeof makeEngine>["engine"], product: string) => {
    const offer = engine.createOffer({
      binding: "digital", household: HOUSEHOLD, purpose: "replenish", config_version: CONFIG_VERSION,
      expires_at: Date.now() + HOUR, mandate: MANDATE, price_band: null, giver: null,
      candidates: [{ product, quantity: 1, predicted_conversion: 0.5, is_exploration: true, given_by: null }],
    } as never);
    await engine.present(offer.id);
    await decideSigned(engine, offer.id, offer.candidates.map((c) => ({ candidate: c.id, valence: "kept" as const, kept_as: "self" as const })));
    return offer;
  };

  test("a settle retried after a failed report tells the day, so the ceiling sees it", async () => {
    // NOTE (mutation check, 2026-09-19): retry_does_not_report.
    const { engine, rows } = withDay(2_000, 0, true);
    const first = await decided(engine, "tea-a");
    await expect(engine.settle(first.id)).rejects.toThrow("hub down");
    expect(rows.size).toBe(0);
    await engine.settle(first.id);
    expect(rows.get(first.id)).toBe(1_200);
    const second = await decided(engine, "coffee-a");
    await expect(engine.settle(second.id)).rejects.toMatchObject({ code: "mandate_ceiling_daily" });
  });

  test("two settles of one payer in flight do not both pass the ceiling", async () => {
    // NOTE (mutation check, 2026-09-19): settle_not_serialised. Both settled,
    // 2,700 against a ceiling of 2,000.
    const { engine, rows } = withDay(2_000, 5);
    const a = await decided(engine, "tea-a");
    const b = await decided(engine, "coffee-a");
    const results = await Promise.allSettled([engine.settle(a.id), engine.settle(b.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect([...rows.values()].reduce((x, y) => x + y, 0)).toBeLessThanOrEqual(2_000);
  });
});

describe("questions 65 and 66: what the first refutation pass over them found", () => {
  test("a line a maker gave counts nothing towards the out-of-network ceiling (clause 10, clause 46)", async () => {
    // NOTE (mutation check, 2026-09-19): given_line_counts_out_of_network.
    const { engine } = makeEngine({ isInNetwork: () => false });
    engine.readMandatesFrom({
      async get() {
        return { id: MANDATE, household: HOUSEHOLD, ceiling_out_of_network: 1_200, ceiling_daily: null,
          cooling_seconds: null, co_signers: [], lapses_at: Date.now() + HOUR, version: 1 } as never;
      },
      async dailyCeilingOf() { return null; },
      async outOfNetworkCeilingOf() { return null; },
      async coolingSecondsOf() { return null; },
      async holdsAny(h: string) { return h === HOUSEHOLD; },
    });
    const offer = engine.createOffer({
      binding: "digital", household: HOUSEHOLD, purpose: "replenish", config_version: CONFIG_VERSION,
      expires_at: Date.now() + HOUR, mandate: MANDATE, price_band: null, giver: null,
      candidates: [
        { product: "tea-a", quantity: 1, predicted_conversion: 0.5, is_exploration: true, given_by: null },
        { product: "coffee-a", quantity: 1, predicted_conversion: 0.5, is_exploration: true, given_by: "maker-a" },
      ],
    } as never);
    expect((await engine.present(offer.id)).state).toBe("presented");
  });

  test("a settlement made here stays the giver's payment and is re-reported when the ledger forgets its hold", async () => {
    // NOTE (mutation check, 2026-09-19): made_here_read_from_the_ledger. The
    // Meter adapter keeps its holds in memory, so after a restart the giver's
    // payments read empty and a failed report could never be repaired.
    const { engine, ledger } = makeEngine();
    const reported: string[] = [];
    engine.readTheDayFrom({ async totalSince() { return 0; }, async report(r: { offer: string }) { reported.push(r.offer); }, async reportOffer() {} } as never);
    const offer = engine.createOffer({
      binding: "digital", household: HOUSEHOLD, purpose: "ceremonial", config_version: CONFIG_VERSION,
      expires_at: Date.now() + HOUR, mandate: MANDATE, price_band: { min: 0, max: 1_000_000 }, giver: GIFT_GIVER.household,
      candidates: [{ product: "tea-a", quantity: 1, predicted_conversion: 0.5, is_exploration: true, given_by: null }],
    } as never);
    await presentGift(engine, offer.id);
    await decideSigned(engine, offer.id, offer.candidates.map((c) => ({ candidate: c.id, valence: "kept" as const, kept_as: "self" as const })));
    await engine.settle(offer.id);
    (ledger as unknown as { get: () => undefined }).get = () => undefined;
    expect(engine.paymentsBy(GIFT_GIVER.household).map((p) => p.offer)).toEqual([offer.id]);
    await engine.settle(offer.id);
    expect(reported).toEqual([offer.id, offer.id]);
  });
});
