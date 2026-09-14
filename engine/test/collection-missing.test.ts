import { describe, expect, test } from "bun:test";
import { CONFIG_VERSION, HOUR, decideSigned, makeEngine, settleSigned } from "./helpers.js";
import { needsStatement, statementLines } from "../src/shared/statement.js";
import { renderStatement } from "../src/hub/statement.js";
import { MISSING_NOTE_LIMIT } from "../src/engine/physical.js";

/**
 * §11.2 and §6.5, question 46, decided 2026-09-14.
 *
 * A collection records what came back, what was used and what was not in the
 * box, with a note for each missing item. Every rule lives in the engine, so
 * an in-process caller meets the refusals the route gives. A missing line is
 * never billed, is on the household's statement and may be disputed, and a
 * household's `returned` gives way to what the collection found.
 */
const physical = (household: string, products: string[]) => ({
  binding: "physical" as const,
  household,
  purpose: "replenish" as const,
  config_version: CONFIG_VERSION,
  expires_at: Date.now() + HOUR,
  mandate: "mandate-1",
  price_band: null,
  giver: null,
  candidates: products.map((product, i) => ({
    product,
    quantity: 1,
    predicted_conversion: 0.5,
    is_exploration: i === 0,
    given_by: null,
  })),
});

async function box(made: ReturnType<typeof makeEngine>, household: string) {
  const offer = made.engine.createOffer(physical(household, ["coffee-a", "tea-b", "miso-a"]));
  await made.engine.present(offer.id);
  made.deliveries.record({ offer: offer.id, carriage: 550, code: `dc-${offer.id.slice(0, 8)}`, status: "delivered" });
  return offer;
}

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return (err as { code?: string }).code;
  }
  return "accepted";
};

describe("§11.2: the collection's rules are the engine's", () => {
  test("an in-process partial collection is refused and leaves nothing recorded", async () => {
    const made = makeEngine();
    const offer = await box(made, "house-part");
    const [a] = offer.candidates;
    expect(code(() => made.engine.collect({ offer: offer.id, returned: [], consumed: [a!.id] }))).toBe("collection_incomplete");
    expect(made.engine.recoveries.for(offer.id)!.collected_at).toBeNull();
    expect(made.engine.mustGet(offer.id).candidates.every((c) => c.valence === "offered")).toBe(true);
  });

  test("a body breaking several rules names them in §11.2's order", async () => {
    const made = makeEngine();
    const offer = await box(made, "house-order");
    const [a, b] = offer.candidates;
    const collect = (body: { returned: string[]; consumed: string[]; missing?: string[]; missing_notes?: Record<string, string> }) =>
      code(() => made.engine.collect({ offer: offer.id, ...body }));
    // stranger, overlap, unexplained missing, incomplete
    expect(collect({ returned: [a!.id, "zz"], consumed: [a!.id], missing: [b!.id] })).toBe("unknown_candidate");
    // overlap, unexplained missing, incomplete
    expect(collect({ returned: [a!.id], consumed: [], missing: [a!.id] })).toBe("returned_and_consumed");
    // unexplained missing, incomplete
    expect(collect({ returned: [], consumed: [], missing: [b!.id] })).toBe("missing_note_required");
    expect(made.engine.recoveries.for(offer.id)!.collected_at).toBeNull();
  });

  test("the same item twice in one list is two verdicts", async () => {
    const made = makeEngine();
    const offer = await box(made, "house-twice");
    const ids = offer.candidates.map((c) => c.id);
    expect(code(() => made.engine.collect({ offer: offer.id, returned: [...ids, ids[0]!], consumed: [] }))).toBe("returned_and_consumed");
  });

  test("a missing item needs a note of bounded length, and the note is kept", async () => {
    const made = makeEngine();
    const offer = await box(made, "house-note");
    const [gone, ...rest] = offer.candidates;
    const body = (note: string) => ({
      offer: offer.id,
      returned: rest.map((c) => c.id),
      consumed: [],
      missing: [gone!.id],
      missing_notes: { [gone!.id]: note },
    });
    expect(code(() => made.engine.collect(body("   ")))).toBe("missing_note_required");
    expect(code(() => made.engine.collect(body("x".repeat(MISSING_NOTE_LIMIT + 1))))).toBe("missing_note_required");
    const row = made.engine.collect(body("not in the box at collection"));
    expect(row.missing_notes).toEqual({ [gone!.id]: "not in the box at collection" });
    expect(made.engine.mustGet(offer.id).candidates.find((c) => c.id === gone!.id)!.valence).toBe("lost");
  });

  test("a kept line is not the collection's to change, and the refusal names what it is", async () => {
    const made = makeEngine();
    const offer = await box(made, "house-kept");
    const [kept, ...rest] = offer.candidates;
    await decideSigned(made.engine, offer.id, [{ candidate: kept!.id, valence: "kept", kept_as: "self" }]);
    let message = "";
    try {
      made.engine.collect({ offer: offer.id, returned: [], consumed: [kept!.id, ...rest.map((c) => c.id)] });
    } catch (err) {
      expect((err as { code?: string }).code).toBe("candidate_decided");
      message = (err as Error).message;
    }
    expect(message).toContain(`${kept!.id} (kept)`);
  });

  test("the collection overrules a household's returned with what it found", async () => {
    const made = makeEngine();
    const offer = await box(made, "house-overrule");
    const [used, gone, back] = offer.candidates;
    await decideSigned(made.engine, offer.id, [
      { candidate: used!.id, valence: "returned" },
      { candidate: gone!.id, valence: "returned" },
    ]);
    made.engine.collect({
      offer: offer.id,
      returned: [back!.id],
      consumed: [used!.id],
      missing: [gone!.id],
      missing_notes: { [gone!.id]: "not found" },
    });
    const after = made.engine.mustGet(offer.id);
    expect(after.candidates.map((c) => c.valence)).toEqual(["consumed", "lost", "returned"]);
    // The overruled lines come to the household to sign or dispute.
    const lines = statementLines(after, [], made.engine.recoveries.for(offer.id)!.missing);
    expect(lines.map((l) => [l.valence, l.amount])).toEqual([
      ["consumed", after.candidates[0]!.unit_price],
      ["lost", 0],
    ]);
  });
});

describe("§6.5: a missing line is on the statement, may be disputed, and moves nothing", () => {
  test("a collection is refused on a settled box (question 46)", async () => {
    // NOTE (mutation check, 2026-09-14): collect_ignores_offer_state accepts it,
    // and this rejection fails. A collection on a settled box would rewrite its
    // valences under a settlement nobody re-signed.
    const made = makeEngine();
    const offer = await box(made, "house-settled");
    // The household decides every line itself, so no collection is needed.
    await decideSigned(made.engine, offer.id, offer.candidates.map((c) => ({ candidate: c.id, valence: "returned" as const })));
    await made.engine.settle(offer.id);
    expect(made.engine.mustGet(offer.id).state).toBe("settled");
    let code = "accepted";
    try {
      made.engine.collect({ offer: offer.id, returned: [], consumed: [offer.candidates[0]!.id], missing: [], at: Date.now() });
    } catch (err) { code = (err as { code?: string }).code ?? "?"; }
    expect(code).toBe("bad_state");
  });

  test("a collection is refused on a withdrawn box (question 46)", async () => {
    // NOTE (mutation check, 2026-09-14): collect_ignores_offer_state accepts it.
    // A presenter's withdraw stamps offered->returned; a collection then
    // overruling those returns would rewrite a withdrawn box.
    const made = makeEngine();
    const offer = await box(made, "house-withdrawn");
    await made.engine.withdraw(offer.id);
    expect(made.engine.mustGet(offer.id).state).toBe("withdrawn");
    let code = "accepted";
    try {
      made.engine.collect({ offer: offer.id, returned: [], consumed: [offer.candidates[0]!.id], missing: [], at: Date.now() });
    } catch (err) { code = (err as { code?: string }).code ?? "?"; }
    expect(code).toBe("bad_state");
  });


  async function missingOnly(made: ReturnType<typeof makeEngine>, household: string) {
    const offer = await box(made, household);
    const [gone, ...rest] = offer.candidates;
    made.engine.collect({
      offer: offer.id,
      returned: rest.map((c) => c.id),
      consumed: [],
      missing: [gone!.id],
      missing_notes: { [gone!.id]: "not in the box" },
    });
    return { offer, gone: gone! };
  }

  test("a box whose only collection line is missing needs the household's signature", async () => {
    const made = makeEngine();
    const { offer, gone } = await missingOnly(made, "house-m1");
    const after = made.engine.mustGet(offer.id);
    const missing = made.engine.recoveries.for(offer.id)!.missing;
    expect(needsStatement(after, missing)).toBe(true);
    expect(statementLines(after, [], missing)).toEqual([{ candidate: gone.id, valence: "lost", amount: 0, disputed: false }]);
    await expect(made.engine.settle(offer.id)).rejects.toMatchObject({ code: "statement_unsigned" });
    const rendered = renderStatement(after, await made.engine.deliveryFor(offer.id), made.engine.recoveries.for(offer.id));
    expect(rendered.lines).toHaveLength(1);
    expect(rendered.lines[0]!.note).toBe("not in the box");
  });

  test("a disputed missing line is recorded and charges nothing", async () => {
    const made = makeEngine();
    const { offer, gone } = await missingOnly(made, "house-m2");
    const settlement = await settleSigned(made.engine, offer.id, [gone.id]);
    expect(settlement.charged).toBe(0);
    expect(settlement.disputed_amount).toBe(0);
    expect(settlement.lines.find((l) => l.candidate === gone.id)).toMatchObject({ valence: "lost", disputed: true });
    expect(settlement.confirmation).not.toBeNull();
  });

  test("a returned line still cannot be disputed", async () => {
    const made = makeEngine();
    const { offer } = await missingOnly(made, "house-m3");
    const back = offer.candidates[1]!.id;
    await expect(settleSigned(made.engine, offer.id, [back])).rejects.toMatchObject({ code: "not_disputable" });
  });

  test("a missing-only box does not hold the presenter's next box", async () => {
    const made = makeEngine();
    await missingOnly(made, "house-m4");
    const second = made.engine.createOffer(physical("house-m4", ["nori-a", "coffee-a"]));
    expect((await made.engine.present(second.id)).state).toBe("presented");
  });

  test("a line the deadline made lost is not on the statement", async () => {
    const made = makeEngine();
    const offer = await box(made, "house-deadline");
    const later = Date.now() + 400 * 86_400_000;
    const after = made.engine.mustGet(offer.id, later);
    expect(after.candidates.every((c) => c.valence === "lost")).toBe(true);
    expect(needsStatement(after, [])).toBe(false);
    expect(statementLines(after, [])).toEqual([]);
  });

  test("a box with a missing line cannot be withdrawn once collected (question 46)", async () => {
    const made = makeEngine();
    made.engine.readMandatesFrom({
      async get() {
        return {
          id: "mandate-1",
          household: "house-m5",
          ceiling_out_of_network: 1_000_000,
          ceiling_daily: null,
          cooling_seconds: 3600,
          co_signers: [],
          lapses_at: Date.now() + 86_400_000,
          version: 1,
        } as never;
      },
    });
    const offer = await box(made, "house-m5");
    const [gone, back, kept] = offer.candidates;
    await decideSigned(made.engine, offer.id, [{ candidate: kept!.id, valence: "kept", kept_as: "self" }]);
    made.engine.collect({
      offer: offer.id,
      returned: [back!.id],
      consumed: [],
      missing: [gone!.id],
      missing_notes: { [gone!.id]: "gone" },
    });
    // A collection fixes what is in the home; the missing line and the kept
    // line stay as the collection left them, and the recourse is the statement.
    await expect(made.engine.withdrawDecisions(offer.id)).rejects.toMatchObject({ code: "not_withdrawable" });
    expect(made.engine.mustGet(offer.id).candidates.map((c) => c.valence)).toEqual(["lost", "returned", "kept"]);
  });

  test("a box that carries a kept line and a missing line holds the next box (question 46)", async () => {
    // The founder's decision of 2026-09-14: a household cannot receive the next
    // box by never signing a statement it owes nothing on but must still answer.
    const made = makeEngine();
    const offer = await box(made, "house-m6");
    const [gone, back, kept] = offer.candidates;
    await decideSigned(made.engine, offer.id, [{ candidate: kept!.id, valence: "kept", kept_as: "self" }]);
    made.engine.collect({
      offer: offer.id,
      returned: [back!.id],
      consumed: [],
      missing: [gone!.id],
      missing_notes: { [gone!.id]: "gone" },
    });
    const second = made.engine.createOffer(physical("house-m6", ["nori-a", "coffee-a"]));
    await expect(made.engine.present(second.id)).rejects.toMatchObject({ code: "statement_unsigned" });
    await settleSigned(made.engine, offer.id);
    expect((await made.engine.present(second.id)).state).toBe("presented");
  });

  test("a row stored before question 46 is read without failing", async () => {
    const { inMemoryStore } = await import("../src/common/store.js");
    const { RecoveryLedger, applyRecovery } = await import("../src/engine/physical.js");
    const store = inMemoryStore();
    const ledger = new RecoveryLedger(store);
    store.map("recoveries").set("old-1", { offer: "old-1", due_at: 0, grace_days: 0, collected_at: 1, returned: ["c1"], consumed: [] } as never);
    const offer = { binding: "physical", candidates: [{ id: "c1", valence: "returned", decided_at: 1 }] } as never;
    expect(() => applyRecovery(offer, ledger.for("old-1"), 2)).not.toThrow();
  });

  test("a collection row moved from a host before question 46 imports with no notes", () => {
    const made = makeEngine();
    made.engine.recoveries.importRows([
      { offer: "moved-1", due_at: 0, grace_days: 0, collected_at: 1, returned: ["c1"], consumed: [] } as never,
    ]);
    expect(made.engine.recoveries.for("moved-1")).toMatchObject({ missing: [], missing_notes: {} });
  });
});
