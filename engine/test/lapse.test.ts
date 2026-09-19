import { describe, expect, test } from "bun:test";
import { sign } from "node:crypto";
import { canonicalMandate, type Mandate } from "../src/hub/mandates.js";
import { canonicalDecisions } from "../src/shared/decisions.js";
import { CONFIG_VERSION, HOUSEHOLD, MANDATE_PAIR, houseFor, makeEngine } from "./helpers.js";

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
