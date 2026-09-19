import { describe, expect, test } from "bun:test";
import { sign } from "node:crypto";
import { MAX_LAPSE_MS, canonicalMandate, type Mandate } from "../src/hub/mandates.js";
import { canonicalDecisions } from "../src/shared/decisions.js";
import { LocalMandates } from "../src/engine/mandate-source.js";
import { CONFIG_VERSION, HOUSEHOLD, MANDATE_PAIR, houseFor, makeEngine, otherHousehold, settleSigned } from "./helpers.js";

/**
 * §16.1, §16.3, §16.5. The lapse, as the first refutation pass over question
 * 68 found it. Question 68 made a household's own offers read the tightest
 * live value across every mandate it holds, and three things about the lapse
 * undid it: a household brought a co-signed mandate's lapse forward alone,
 * after which a loose label governed; a mandate naming a co-signer nobody
 * holds bound every label with a lapse nothing bounded; and a lapse ended the
 * cooling window and the daily ceiling of sets already decided. The founder
 * decided all three together on 2026-09-19.
 *
 * Everything here goes through the real register and the real engine on a
 * virtual clock, which is how the refutation measured them, so a lapse is
 * crossed without waiting for one.
 */
const RP = "unit.example";
const CO = houseFor("lapse-co-signer");
const KEYS: Record<string, string> = {
  [HOUSEHOLD]: MANDATE_PAIR.publicKey.export({ type: "spki", format: "pem" }).toString(),
  [CO.household]: CO.pem,
};
const DAY = 86_400_000;

const mandate = (label: string, over: Partial<Mandate>, now: number): Mandate => ({
  id: `${HOUSEHOLD}.${label}`, household: HOUSEHOLD, ceiling_out_of_network: 0,
  ceiling_daily: null, cooling_seconds: null, co_signers: [], lapses_at: now + 300 * DAY, version: 1, ...over,
});

type Engine = ReturnType<typeof makeEngine>["engine"];

const record = (engine: Engine, m: Mandate, now: number, withCo = false) => {
  const bytes = canonicalMandate(m, RP);
  const signatures: Record<string, string> = {
    [HOUSEHOLD]: sign(null, bytes, MANDATE_PAIR.privateKey).toString("base64"),
  };
  if (withCo) signatures[CO.household] = CO.sign(bytes);
  return engine.mandates.record({ mandate: m, signatures, assertions: {}, keyOf: (k) => KEYS[k], relyingPartyId: RP, now });
};

const refusal = (f: () => unknown) => {
  try {
    f();
  } catch (err) {
    return (err as { code?: string }).code;
  }
  return "accepted";
};

const offer = (engine: Engine, mandateId: string, now: number, product = "tea-a") => engine.createOffer({
  binding: "digital", household: HOUSEHOLD, purpose: "replenish", config_version: CONFIG_VERSION,
  expires_at: now + 30 * DAY, mandate: mandateId, price_band: null, giver: null,
  candidates: [{ product, quantity: 1, predicted_conversion: 0.5, is_exploration: true, given_by: null }],
} as never);

const keep = async (engine: Engine, id: string, now: number) => {
  const decisions = engine.mustGet(id, now).candidates.map((c) => ({ candidate: c.id, valence: "kept" as const, kept_as: "self" as const }));
  const signature = sign(null, canonicalDecisions(id, decisions), MANDATE_PAIR.privateKey).toString("base64");
  return engine.decide(id, decisions, signature, now);
};

describe("§16.1: bringing a co-signed mandate's lapse forward is a loosening", () => {
  test("the household alone cannot bring it forward, and so cannot let a loose label govern", async () => {
    // NOTE (mutation check, 2026-09-19): lapse_forward_is_the_households_alone.
    // The refusal assertion read "accepted": the household's lone signature
    // brought the lapse forward, which is the first step of the escape the
    // refutation measured to a settlement of 1,200 under the loose label.
    const T = Date.now();
    const { engine } = makeEngine({ isInNetwork: () => false });
    const one = mandate("1", { ceiling_daily: 0, cooling_seconds: 86_400, co_signers: [CO.household] }, T);
    record(engine, one, T);
    const two = mandate("2", { ceiling_out_of_network: 10_000_000 }, T);
    record(engine, two, T);

    expect(refusal(() => record(engine, { ...one, lapses_at: T + 1_000, version: 2 }, T))).toBe("unsigned");

    // So `.1` is still live a second later, and still binds the second label.
    const T2 = T + 2_000;
    const later = offer(engine, two.id, T2);
    await expect(engine.present(later.id, T2)).rejects.toMatchObject({ code: "mandate_ceiling_out_of_network" });

    // With the co-signer it is a change the people it protects agreed to.
    expect(record(engine, { ...one, lapses_at: T + 1_000, version: 2 }, T, true).version).toBe(2);
  });

  test("a mandate that names nobody is still the household's alone, and a later lapse still needs its co-signers", () => {
    const T = Date.now();
    const { engine } = makeEngine();
    const alone = mandate("1", {}, T);
    record(engine, alone, T);
    expect(record(engine, { ...alone, lapses_at: T + 1_000, version: 2 }, T).version).toBe(2);

    const named = mandate("2", { co_signers: [CO.household] }, T);
    record(engine, named, T);
    expect(refusal(() => record(engine, { ...named, lapses_at: named.lapses_at + DAY, version: 2 }, T))).toBe("unsigned");
    // A tightening that leaves the lapse where it was is still the household's alone.
    expect(record(engine, { ...named, cooling_seconds: 60, version: 2 }, T).version).toBe(2);
  });
});

describe("§16.1, clause 58: a lapse is at most a year out", () => {
  test("a household that has lost its co-signer is held for at most a year", async () => {
    // NOTE (mutation check, 2026-09-19): lapse_unbounded. The first refusal
    // assertion read "accepted": a lapse in the year 9999 was recorded.
    //
    // The refutation's freeze: the household, or whoever holds its key,
    // records `.9` with a daily ceiling of 0, a ten-year window and a
    // co-signer nobody holds. Question 68 makes it bind every label, and
    // bringing its lapse forward needs that co-signer, so the lapse is the
    // only way out; it was measured accepting the year 9999.
    const T = Date.now();
    const { engine } = makeEngine({ isInNetwork: () => false });
    const loose = mandate("1", { ceiling_out_of_network: 10_000_000 }, T);
    record(engine, loose, T);
    const lost = otherHousehold().household;
    const freeze = mandate("9", { ceiling_out_of_network: 0, ceiling_daily: 0, cooling_seconds: 10 * 365 * 86_400, co_signers: [lost] }, T);

    expect(refusal(() => record(engine, { ...freeze, lapses_at: Date.UTC(9999, 0, 1) }, T))).toBe("lapse_too_far");
    expect(refusal(() => record(engine, { ...freeze, lapses_at: T + MAX_LAPSE_MS + 1 }, T))).toBe("lapse_too_far");
    record(engine, { ...freeze, lapses_at: T + MAX_LAPSE_MS }, T);

    // Frozen while it is live, and the household alone cannot end it early.
    const early = offer(engine, loose.id, T);
    await expect(engine.present(early.id, T)).rejects.toMatchObject({ code: "mandate_ceiling_out_of_network" });
    expect(refusal(() => record(engine, { ...freeze, lapses_at: T + 1_000, version: 2 }, T))).toBe("unsigned");

    // A year and a day on, it has lapsed and binds nothing.
    const after = T + MAX_LAPSE_MS + 1;
    // `.1` names nobody, so the household renews it alone.
    record(engine, { ...loose, lapses_at: after + 300 * DAY, version: 2 }, after);
    const later = offer(engine, loose.id, after, "tea-b");
    expect((await engine.present(later.id, after)).state).toBe("presented");
  });

  test("the reference hub's renewal, a year from the member's clock, is within the bound", () => {
    // `atarasy/src/client/app.ts` writes `Date.now() + 365 * 86_400_000` on the
    // member's device and the version is recorded afterwards, on the host's
    // clock; a day of slack covers a device clock that runs ahead.
    const T = Date.now();
    const { engine } = makeEngine();
    const renewal = mandate("1", { lapses_at: T + 365 * 86_400_000 + 60_000 }, T);
    expect(record(engine, renewal, T).lapses_at).toBe(renewal.lapses_at);
  });
});

describe("§16.3, §16.5: a decided set keeps what it was decided under", () => {
  /**
   * The refutation's probes 2 and 2b, one mandate each. On main the named
   * mandate was read whether or not it had lapsed; question 68 read only the
   * live ones, so a lapse ended a running window and removed the daily
   * ceiling of sets already decided. Measured with nobody acting at all.
   */
  const decidedUnder = async (over: Partial<Mandate>, lapsesIn: number) => {
    const T = Date.now();
    const made = makeEngine({ isInNetwork: () => false });
    const one = mandate("1", { ceiling_out_of_network: 10_000_000, co_signers: [CO.household], lapses_at: T + lapsesIn, ...over }, T);
    record(made.engine, one, T);
    const big = offer(made.engine, one.id, T);
    const small = offer(made.engine, one.id, T, "tea-b");
    await made.engine.present(big.id, T);
    await made.engine.present(small.id, T);
    await keep(made.engine, big.id, T + 1);
    await keep(made.engine, small.id, T + 1);
    return { ...made, T, one, big, small };
  };

  test("a lapse does not end a running window, and the set can still be taken back", async () => {
    // NOTE (mutation check, 2026-09-19): settle_window_not_fixed,
    // withdraw_window_not_fixed and decision_fixes_nothing.
    const { engine, T, big, small } = await decidedUnder({ ceiling_daily: 500, cooling_seconds: 86_400 }, 60_000);
    const after = T + 61_000;
    await expect(engine.settle(small.id, after)).rejects.toMatchObject({ code: "mandate_cooling" });
    expect((await engine.withdrawDecisions(big.id, after)).state).toBe("presented");
  });

  test("nor when the co-signer agrees to bring the lapse forward", async () => {
    const { engine, T, one, big, small } = await decidedUnder({ ceiling_daily: 500, cooling_seconds: 86_400 }, 300 * DAY);
    record(engine, { ...one, lapses_at: T + 10_000, version: 2 }, T + 3, true);
    const after = T + 11_000;
    await expect(engine.settle(small.id, after)).rejects.toMatchObject({ code: "mandate_cooling" });
    expect((await engine.withdrawDecisions(big.id, after)).state).toBe("presented");
  });

  test("a lapse does not remove the daily ceiling of a set decided under it", async () => {
    // NOTE (mutation check, 2026-09-19): settle_daily_not_fixed and
    // decision_fixes_nothing.
    const { engine, T, small } = await decidedUnder({ ceiling_daily: 500 }, 60_000);
    await expect(engine.settle(small.id, T + 61_000)).rejects.toMatchObject({ code: "mandate_ceiling_daily" });
  });

  test("a set decided after the lapse is not held to the lapsed mandate", async () => {
    // The founder's rule is the mandates live when the set was decided, and
    // not every mandate the household ever held.
    const T = Date.now();
    const { engine } = makeEngine({ isInNetwork: () => false });
    const tight = mandate("1", { ceiling_out_of_network: 10_000_000, ceiling_daily: 500, lapses_at: T + 60_000 }, T);
    const loose = mandate("2", { ceiling_out_of_network: 10_000_000 }, T);
    record(engine, tight, T);
    record(engine, loose, T);
    const later = T + 61_000;
    const set = offer(engine, loose.id, later, "tea-b");
    await engine.present(set.id, later);
    await keep(engine, set.id, later);
    expect((await engine.settle(set.id, later + 1)).charged).toBe(900);
  });

  test("a collection that decides a box fixes what is live at its moment", async () => {
    // NOTE (mutation check, 2026-09-19): collection_fixes_nothing. The box
    // settled at 1,200 past a daily ceiling of 500 once the mandate that set
    // it had lapsed.
    const T = Date.now();
    const made = makeEngine({ isInNetwork: () => false });
    const { engine, deliveries } = made;
    const one = mandate("1", { ceiling_out_of_network: 10_000_000, ceiling_daily: 500, co_signers: [CO.household], lapses_at: T + 60_000 }, T);
    record(engine, one, T);
    const box = engine.createOffer({
      binding: "physical", household: HOUSEHOLD, purpose: "replenish", config_version: CONFIG_VERSION,
      expires_at: T + 30 * DAY, mandate: one.id, price_band: null, giver: null,
      candidates: [
        { product: "tea-a", quantity: 1, predicted_conversion: 0.5, is_exploration: true, given_by: null },
        { product: "tea-b", quantity: 1, predicted_conversion: 0.5, is_exploration: false, given_by: null },
      ],
    } as never);
    await engine.present(box.id, T);
    deliveries.record({ offer: box.id, carriage: 0, code: `dc-${box.id.slice(0, 8)}`, status: "delivered" });
    await engine.collectDeciding({ offer: box.id, returned: [box.candidates[1]!.id], consumed: [box.candidates[0]!.id], at: T + 1 });
    expect(engine.mustGet(box.id, T + 1).state).toBe("decided");
    await expect(settleSigned(engine, box.id, [], T + 61_000)).rejects.toMatchObject({ code: "mandate_ceiling_daily" });
  });
});

describe("§10.5: the read at a decision does not let two decisions through", () => {
  test("two decisions in flight over one set: one is applied and the other refused", async () => {
    // NOTE (mutation check, 2026-09-19): decision_recheck_dropped. Both
    // decisions were applied, the second over the first, and two
    // confirmations were recorded for one set.
    //
    // Fixing a set's protections at its decision made `decide` wait on the
    // source before writing, which it had not done: every check ran and every
    // line was written with no wait between them. A hub read takes a round
    // trip, and another decision of the same lines can arrive during it.
    const T = Date.now();
    const { engine } = makeEngine();
    const m = mandate("1", { ceiling_out_of_network: 10_000_000, cooling_seconds: 60 }, T);
    record(engine, m, T);
    const local = new LocalMandates(engine.mandates);
    const wait = () => new Promise((r) => setTimeout(r, 5));
    engine.readMandatesFrom({
      get: (id) => local.get(id),
      holdsAny: (h) => local.holdsAny(h),
      outOfNetworkCeilingOf: (h, n) => local.outOfNetworkCeilingOf(h, n),
      async dailyCeilingOf(h, n) { await wait(); return local.dailyCeilingOf(h, n); },
      async coolingSecondsOf(h, n) { await wait(); return local.coolingSecondsOf(h, n); },
    });
    const o = offer(engine, m.id, T);
    await engine.present(o.id, T);
    const set = (valence: "kept" | "returned") => o.candidates.map((c) => valence === "kept"
      ? { candidate: c.id, valence, kept_as: "self" as const }
      : { candidate: c.id, valence });
    const signed = (d: ReturnType<typeof set>) => sign(null, canonicalDecisions(o.id, d), MANDATE_PAIR.privateKey).toString("base64");
    const results = await Promise.allSettled([
      engine.decide(o.id, set("kept"), signed(set("kept")), T + 1),
      engine.decide(o.id, set("returned"), signed(set("returned")), T + 1),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((refused.reason as { code?: string }).code).toBe("already_decided");
  });
});
