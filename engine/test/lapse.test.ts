import { describe, expect, test } from "bun:test";
import { sign } from "node:crypto";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../src/common/store.js";
import { MAX_COOLING_SECONDS, MAX_LAPSE_MS, canonicalMandate, type Mandate } from "../src/hub/mandates.js";
import { canonicalDecisions, canonicalWithdrawal } from "../src/shared/decisions.js";
import { LocalMandates } from "../src/engine/mandate-source.js";
import { CONFIG_VERSION, GIFT_GIVER, HOUSEHOLD, MANDATE, MANDATE_PAIR, houseFor, makeEngine, otherHousehold, presentGift, settleSigned, withdrawSigned } from "./helpers.js";

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

describe("§16.1, clause 58: a lapse is at most 400 days out", () => {
  test("a household that has lost its co-signer is held for at most 400 days", async () => {
    // NOTE (mutation check, 2026-09-19): lapse_unbounded. The first refusal
    // assertion read "accepted": a lapse in the year 9999 was recorded.
    //
    // The refutation's freeze: the household, or whoever holds its key,
    // records `.9` with a daily ceiling of 0, the longest window §16.5 now
    // allows and a co-signer nobody holds. Question 68 makes it bind every
    // label, and bringing its lapse forward needs that co-signer, so the
    // lapse is the only way out; it was measured accepting the year 9999.
    // The refutation's own window was ten years, which §16.5 has refused at
    // the record since 2026-09-20.
    const T = Date.now();
    const { engine } = makeEngine({ isInNetwork: () => false });
    const loose = mandate("1", { ceiling_out_of_network: 10_000_000 }, T);
    record(engine, loose, T);
    const lost = otherHousehold().household;
    const freeze = mandate("9", { ceiling_out_of_network: 0, ceiling_daily: 0, cooling_seconds: MAX_COOLING_SECONDS, co_signers: [lost] }, T);

    expect(refusal(() => record(engine, { ...freeze, lapses_at: Date.UTC(9999, 0, 1) }, T))).toBe("lapse_too_far");
    expect(refusal(() => record(engine, { ...freeze, lapses_at: T + MAX_LAPSE_MS + 1 }, T))).toBe("lapse_too_far");
    record(engine, { ...freeze, lapses_at: T + MAX_LAPSE_MS }, T);

    // Frozen while it is live, and the household alone cannot end it early.
    const early = offer(engine, loose.id, T);
    await expect(engine.present(early.id, T)).rejects.toMatchObject({ code: "mandate_ceiling_out_of_network" });
    expect(refusal(() => record(engine, { ...freeze, lapses_at: T + 1_000, version: 2 }, T))).toBe("unsigned");

    // 400 days and a millisecond on, it has lapsed and binds nothing.
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

  test("a device a week fast still records every kind of change (§16.1)", () => {
    // NOTE (mutation check, 2026-09-20): lapse_bound_is_a_year. Each
    // assertion below read "lapse_too_far" at 366 days.
    //
    // The second refutation pass over question 68 measured the bound of 366
    // days as one day of tolerance for a clock the hub does not own: the
    // screen computes `Date.now() + 365` days on the member's device, and
    // every button writes a whole version, so a phone two days fast could set
    // no ceiling, no window and no co-signer. The bound is there to bound the
    // freeze, so it is 400 days and the tolerance is 35.
    const T = Date.now();
    const { engine } = makeEngine();
    const renewal = (daysFast: number, version: number, fields: Partial<Mandate> = {}) =>
      record(
        engine,
        mandate("1", { ...fields, lapses_at: T + daysFast * DAY + 365 * DAY, version }, T),
        T
      );
    // A day fast was already within the old bound; two days was not, and a
    // week is an ordinary wrong date.
    expect(renewal(2, 1).version).toBe(1);
    expect(renewal(7, 2, { ceiling_daily: 500 }).ceiling_daily).toBe(500);
    expect(renewal(7, 3, { cooling_seconds: 3_600 }).cooling_seconds).toBe(3_600);
    // And the bound still bounds: 400 days from the host's clock records, a
    // millisecond further does not.
    expect(record(engine, mandate("2", { lapses_at: T + MAX_LAPSE_MS }, T), T).version).toBe(1);
    expect(refusal(() => record(engine, mandate("3", { lapses_at: T + MAX_LAPSE_MS + 1 }, T), T))).toBe("lapse_too_far");
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
    expect((await withdrawSigned(engine, big.id, after)).state).toBe("presented");
  });

  test("nor when the co-signer agrees to bring the lapse forward", async () => {
    const { engine, T, one, big, small } = await decidedUnder({ ceiling_daily: 500, cooling_seconds: 86_400 }, 300 * DAY);
    record(engine, { ...one, lapses_at: T + 10_000, version: 2 }, T + 3, true);
    const after = T + 11_000;
    await expect(engine.settle(small.id, after)).rejects.toMatchObject({ code: "mandate_cooling" });
    expect((await withdrawSigned(engine, big.id, after)).state).toBe("presented");
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

  test("a collection that decides a box fixes what is live at its moment, in process", async () => {
    // NOTE (mutation check, 2026-09-19): collection_fixes_nothing. The box
    // settled at 1,200 past a daily ceiling of 500 once the mandate that set
    // it had lapsed.
    //
    // **This calls `engine.collect` and not a route**, which is the point.
    // The rule lived on a `collectDeciding` only the route called until
    // 2026-09-20, and `collect` decided a box and recorded nothing; two
    // callers outside the tests take that path, one of them the service
    // behind api-dev.vox.delivery. Named by the second refutation pass over
    // question 68, and §11.2 is the section that says every rule of a
    // collection is the engine's.
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
    await engine.collect({ offer: box.id, returned: [box.candidates[1]!.id], consumed: [box.candidates[0]!.id], at: T + 1 });
    expect(engine.mustGet(box.id, T + 1).state).toBe("decided");
    await expect(settleSigned(engine, box.id, [], T + 61_000)).rejects.toMatchObject({ code: "mandate_ceiling_daily" });
  });
});

describe("§16.5: a recorded cooling window is at most 30 days", () => {
  test("the thirty-year trap is refused at the record", async () => {
    // NOTE (mutation check, 2026-09-20): cooling_unbounded. The refusal
    // assertions read "accepted", the settlement a month on was refused
    // `mandate_cooling`, and the one thirty years on was refused too.
    //
    // The second refutation pass over question 68, probe 11. A window is
    // recorded at the decision and outlives the mandate that set it, and
    // nothing bounded the window: thirty years recorded, a set decided under
    // it, the window dropped a second later and alone (lengthening is a
    // tightening, so shortening it back needs nobody here), and that set
    // could never settle, under a mandate showing no window at all.
    const T = Date.now();
    const THIRTY_YEARS = 30 * 365 * 86_400;
    const { engine } = makeEngine({ isInNetwork: () => false });
    const base = { ceiling_out_of_network: 10_000_000 };
    expect(refusal(() => record(engine, mandate("1", { ...base, cooling_seconds: THIRTY_YEARS }, T), T)))
      .toBe("cooling_too_long");
    expect(refusal(() => record(engine, mandate("1", { ...base, cooling_seconds: MAX_COOLING_SECONDS + 1 }, T), T)))
      .toBe("cooling_too_long");

    // The bound itself records, and the hold it buys is bounded with it: the
    // same trap now releases 30 days after the decision rather than in 2056.
    const one = record(engine, mandate("1", { ...base, cooling_seconds: MAX_COOLING_SECONDS }, T), T);
    const o = offer(engine, one.id, T);
    await engine.present(o.id, T);
    await keep(engine, o.id, T);
    record(engine, mandate("1", { ...base, cooling_seconds: null, version: 2 }, T), T + 1_000);
    const window = MAX_COOLING_SECONDS * 1_000;
    await expect(engine.settle(o.id, T + window - 1)).rejects.toMatchObject({ code: "mandate_cooling" });
    expect((await engine.settle(o.id, T + window + 1)).charged).toBe(1_200);
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

describe("§10.5: a decision that fails writes nothing, on the disk too", () => {
  test("a day source that throws leaves no record behind", async () => {
    // NOTE (mutation check, 2026-09-20): decide_writes_before_the_day. The
    // last assertion read one row: `decided_protections` on the disk of a set
    // the disk still held as `presented`.
    //
    // The second refutation pass over question 68, probe 9(b). The record
    // went in before the day was told, and the day is the last thing in
    // `decide` that can fail, so a hub that was down left a durable row for a
    // decision that never happened. Nothing wrapped the three writes.
    // §10.5's "nothing is written on refusal" had been true of the disk on
    // this path until the record existed.
    const T = Date.now();
    const dir = mkdtempSync(join(tmpdir(), "q68-decide-"));
    const path = join(dir, "engine.sqlite");
    const store = openStore(path);
    const { engine } = makeEngine({ isInNetwork: () => false }, store);
    record(engine, mandate("1", { ceiling_out_of_network: 10_000_000, ceiling_daily: 500, cooling_seconds: 86_400 }, T), T);
    const o = offer(engine, MANDATE, T);
    await engine.present(o.id, T);
    engine.readTheDayFrom({
      async reportOffer() { throw new Error("the hub is down"); },
      async report() {}, async totalSince() { return 0; },
    } as never);
    await expect(keep(engine, o.id, T)).rejects.toThrow("the hub is down");
    store.close();

    const db = new Database(path, { readonly: true });
    const offers = (db.query(`select v from "offers"`).all() as { v: string }[])
      .map((r) => (JSON.parse(r.v) as { state: string }).state);
    const rows = db.query(`select k from "decided_protections"`).all();
    db.close();
    rmSync(dir, { recursive: true, force: true });
    expect(offers).toEqual(["presented"]);
    expect(rows).toEqual([]);
  });
});

describe("§16.1: a protection is a whole number and never below zero", () => {
  test("the register refuses what only the HTTP route refused", () => {
    // NOTE (mutation check, 2026-09-20): protection_has_no_floor. Every
    // assertion below read "accepted".
    //
    // The third refutation pass over question 68 measured the register taking
    // `cooling_seconds: -1`, `0.5` and a ceiling of -5. The floor was at the
    // route (`requireInteger(..., 0)`) and the register is what the deployment
    // acceptance flow and every test call directly.
    const T = Date.now();
    const { engine } = makeEngine();
    const bad = (over: Partial<Mandate>) => refusal(() => record(engine, mandate("1", over, T), T));
    expect(bad({ cooling_seconds: -1 })).toBe("not_a_protection");
    expect(bad({ cooling_seconds: 0.5 })).toBe("not_a_protection");
    expect(bad({ ceiling_daily: -5 })).toBe("not_a_protection");
    expect(bad({ ceiling_out_of_network: -5 })).toBe("not_a_protection");
    // Zero is a protection and the tightest of them, not an absent one.
    expect(record(engine, mandate("1", { cooling_seconds: 0, ceiling_daily: 0 }, T), T).version).toBe(1);
  });

  test("a source answering outside the bounds is read at the nearest value inside them", async () => {
    // NOTE (mutation check, 2026-09-20): engine_reads_any_window. The
    // settlement a month on was refused `mandate_cooling` instead of
    // charging, which is the thirty-year hold the bound exists to stop,
    // reached through a source rather than through the register.
    //
    // The bound was in `MandateRegister.record` alone, so a hub that is not
    // this register, and a row written before the bound, still fixed a set
    // for thirty years. Measured by the third refutation pass over question 68.
    const T = Date.now();
    const THIRTY_YEARS = 30 * 365 * 86_400;
    const { engine } = makeEngine({ isInNetwork: () => false });
    const one = record(engine, mandate("1", { ceiling_out_of_network: 10_000_000 }, T), T);
    // A source outside this register: the shape §13.1 defines, answering what
    // §16 does not allow a mandate to hold.
    engine.readMandatesFrom({
      get: async (id: string) => engine.mandates.get(id),
      holdsAny: async () => true,
      dailyCeilingOf: async () => -5,
      outOfNetworkCeilingOf: async () => 10_000_000,
      coolingSecondsOf: async () => THIRTY_YEARS,
    });
    const o = offer(engine, one.id, T);
    await engine.present(o.id, T);
    await keep(engine, o.id, T);
    const window = MAX_COOLING_SECONDS * 1_000;
    await expect(engine.settle(o.id, T + window - 1)).rejects.toMatchObject({ code: "mandate_cooling" });
    // Past the bound the window is over, and the negative ceiling is read as
    // zero, which is the tightest protection and not the absence of one.
    await expect(engine.settle(o.id, T + window + 1)).rejects.toMatchObject({ code: "mandate_ceiling_daily" });
  });
});

describe("§16.5: a signed set is taken back by a signature over taking it back", () => {
  test("a caller holding the offer id cannot turn a written refusal into a purchase", async () => {
    // NOTE (mutation check, 2026-09-20): withdraw_takes_any_caller. The
    // unsigned take-back succeeded, the expiry defaulted the line the
    // recipient had refused, and the giver was charged 1,200.
    //
    // The third refutation pass over question 68, its finding 2, and the
    // thing nobody had listed in three passes. Each half was known and
    // correct: §16.1 says taking a set back asks for no signature, because
    // withdrawing removes a commitment; §16.5 now makes the window the
    // longest across every mandate the household holds. The join is that the
    // window is the interval in which the unsigned route is open, so
    // question 68 lengthened it. On `main` the same attack is refused
    // `bad_state`, because there the window came from the label the offer
    // names and had closed.
    const T = Date.now();
    const { engine } = makeEngine({ isInNetwork: () => false });
    const base = { ceiling_out_of_network: 10_000_000 };
    // The gift names `.1`, which sets no window. `.2` is a second label the
    // household recorded alone, with the longest window §16.5 allows.
    record(engine, mandate("1", base, T), T);
    record(engine, mandate("2", { ...base, cooling_seconds: MAX_COOLING_SECONDS }, T), T);

    const gift = engine.createOffer({
      binding: "digital", household: HOUSEHOLD, purpose: "ceremonial", config_version: CONFIG_VERSION,
      expires_at: T + 2 * DAY, mandate: `${HOUSEHOLD}.1`, price_band: { min: 0, max: 10_000_000 },
      giver: GIFT_GIVER.household,
      candidates: [{ product: "tea-a", quantity: 1, predicted_conversion: 0.5, is_exploration: true, given_by: null }],
    } as never);
    await presentGift(engine, gift.id, T);
    const decisions = engine.mustGet(gift.id, T).candidates.map((c) => ({ candidate: c.id, valence: "returned" as const }));
    await engine.decide(gift.id, decisions, sign(null, canonicalDecisions(gift.id, decisions), MANDATE_PAIR.privateKey).toString("base64"), T);
    // It owes nothing, so §6.4 would settle it at once; the second label's
    // window holds it in `decided` instead, which is what gives the attack
    // its five days.
    expect(engine.mustGet(gift.id, T).state).toBe("decided");

    const five = T + 5 * DAY;
    await expect(engine.withdrawDecisions(gift.id, { signature: "" }, five))
      .rejects.toMatchObject({ code: "bad_signature" });
    // A signature over another offer's withdrawal is not this one's either.
    const elsewhere = sign(null, Buffer.from(["valence.withdraw.1", "offer-elsewhere", String(T)].join("\n")), MANDATE_PAIR.privateKey).toString("base64");
    await expect(engine.withdrawDecisions(gift.id, { signature: elsewhere }, five))
      .rejects.toMatchObject({ code: "bad_signature" });

    // So the refusal stands past the expiry, and the giver pays for nothing.
    engine.sweep(five);
    expect(engine.mustGet(gift.id, five).candidates.map((c) => c.valence)).toEqual(["returned"]);
    // Past the second label's window, the refusal settles at nothing.
    const after = T + MAX_COOLING_SECONDS * 1_000 + 1;
    expect((await engine.settle(gift.id, after)).charged).toBe(0);
    expect(engine.paymentsBy(GIFT_GIVER.household).map((p) => p.charged)).toEqual([0]);
  });

  test("the household's own take-back still works, and a re-decision needs its own", async () => {
    const T = Date.now();
    const { engine } = makeEngine({ isInNetwork: () => false });
    record(engine, mandate("1", { ceiling_out_of_network: 10_000_000, cooling_seconds: 86_400 }, T), T);
    const o = offer(engine, `${HOUSEHOLD}.1`, T);
    await engine.present(o.id, T);
    await keep(engine, o.id, T);
    const taken = await withdrawSigned(engine, o.id, T + 60_000);
    expect(taken.state).toBe("presented");

    // The moment of the decision is inside the signed bytes, so the
    // signature that took the first set back does not take the second back.
    const spent = sign(null, canonicalWithdrawal(o.id, T), MANDATE_PAIR.privateKey).toString("base64");
    // A different set, because §10.5 spends a confirmation once.
    const again = engine.mustGet(o.id, T + 120_000).candidates.map((c) => ({ candidate: c.id, valence: "returned" as const }));
    await engine.decide(o.id, again, sign(null, canonicalDecisions(o.id, again), MANDATE_PAIR.privateKey).toString("base64"), T + 120_000);
    await expect(engine.withdrawDecisions(o.id, { signature: spent }, T + 180_000))
      .rejects.toMatchObject({ code: "bad_signature" });
    expect((await withdrawSigned(engine, o.id, T + 180_000)).state).toBe("presented");
  });
});
