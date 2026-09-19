import { describe, expect, test } from "bun:test";
import { sign } from "node:crypto";
import { createApp } from "../src/http.js";
import { ApprovalDesk } from "../src/hub/approval.js";
import { DeliveryRegister } from "../src/hub/delivery.js";
import { RecoveryRegister } from "../src/hub/node.js";
import { PermissionLedger } from "../src/hub/permissions.js";
import { Registry } from "../src/shared/registry.js";
import { inMemoryStore } from "../src/common/store.js";
import { RemoteMandates } from "../src/engine/mandate-source.js";
import { canonicalMandate, type Mandate } from "../src/hub/mandates.js";
import { canonicalDecisions } from "../src/shared/decisions.js";
import {
  CONFIG_VERSION, HOUSEHOLD, MANDATE, MANDATE_PAIR, houseFor, makeEngine, presentGift,
} from "./helpers.js";

/**
 * §16.3, §16.5, decided 2026-09-20 after the second refutation pass over
 * question 68. **A decision is never refused because the mandate source could
 * not answer.**
 *
 * The hub here is the reference's own route handler with `cooling_seconds`
 * stripped from `GET /_node/mandates?household=`, which is exactly a hub built
 * one day earlier: questions 60 and 65 were on main and question 68 was not.
 * This is the pass's own probe 7, run against a split deployment in process.
 *
 * What the first build did to it: the household's refusal of a gift was
 * refused `hub_refused`, the offer reached its expiry with every line still
 * `offered`, §12 defaulted them, and the giver was charged 700 for goods the
 * recipient had declined.
 */
const RP = "unit.example";
const GIVER = houseFor("old-hub-giver");
const DAY = 86_400_000;

function split(fields: Partial<Mandate> = {}) {
  const T = Date.now();
  const { engine: hubEngine } = makeEngine({ relyingPartyId: RP });
  hubEngine.registerIdentity(GIVER.household, GIVER.pem);
  const store = inMemoryStore();
  const hub = createApp(
    hubEngine,
    {
      deliveries: new DeliveryRegister(store), approvals: new ApprovalDesk(store),
      recovery: new RecoveryRegister(store), permissions: new PermissionLedger(store),
      registry: new Registry(store),
    },
    new Set(["hub"]) as never
  );
  /** A hub one version older: the household route carries no `cooling_seconds`. */
  const era = { old: true };
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const answer = await hub(new Request(url, init));
    if (!era.old || !new URL(url).search.includes("household=")) return answer;
    const body = await answer.json() as Record<string, unknown>;
    delete body.cooling_seconds;
    return new Response(JSON.stringify(body), { status: answer.status });
  };
  const { engine, ledger, deliveries } = makeEngine({ isInNetwork: () => true });
  engine.registerIdentity(GIVER.household, GIVER.pem);
  engine.readMandatesFrom(new RemoteMandates("http://hub.example", fetchImpl as never));

  const record = async (m: Mandate, who: string, key: (b: Buffer) => string) => {
    const answer = await hub(new Request("http://hub.example/_node/mandates", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...m, signatures: { [who]: key(canonicalMandate(m, RP)) } }),
    }));
    expect([m.id, answer.status]).toEqual([m.id, 201]);
  };
  const base: Omit<Mandate, "id" | "household"> = {
    ceiling_out_of_network: 10_000_000, ceiling_daily: null, cooling_seconds: null,
    co_signers: [], version: 1, lapses_at: T + 300 * DAY,
  };
  return {
    T, engine, ledger, deliveries, era,
    async setUp() {
      await record(
        { ...base, ...fields, id: MANDATE, household: HOUSEHOLD }, HOUSEHOLD,
        (b) => sign(null, b, MANDATE_PAIR.privateKey).toString("base64")
      );
      await record(
        { ...base, id: `${GIVER.household}.1`, household: GIVER.household },
        GIVER.household, (b) => GIVER.sign(b)
      );
    },
    own(product = "tea-a", now = T) {
      return engine.createOffer({
        binding: "digital", household: HOUSEHOLD, purpose: "replenish", config_version: CONFIG_VERSION,
        expires_at: now + DAY, mandate: MANDATE, price_band: null, giver: null,
        candidates: [{ product, quantity: 1, predicted_conversion: 0.5, is_exploration: true, given_by: null }],
      } as never);
    },
    decideAll(id: string, valence: "kept" | "returned", now = T) {
      const decisions = engine.mustGet(id, now).candidates.map((c) => valence === "kept"
        ? { candidate: c.id, valence, kept_as: "self" as const }
        : { candidate: c.id, valence });
      const signature = sign(null, canonicalDecisions(id, decisions), MANDATE_PAIR.privateKey).toString("base64");
      return engine.decide(id, decisions, signature, now);
    },
  };
}

describe("§16.3, §16.5: a hub that cannot answer does not refuse a decision", () => {
  test("a household's refusal of a gift is not turned into a purchase", async () => {
    // NOTE (mutation check, 2026-09-20): decide_refuses_a_silent_hub. The
    // decision assertion read `hub_refused`, the expiry defaulted the line
    // the recipient had declined, and the giver was charged 700.
    const s = split();
    await s.setUp();
    const gift = s.engine.createOffer({
      binding: "digital", household: HOUSEHOLD, purpose: "ceremonial", config_version: CONFIG_VERSION,
      expires_at: s.T + 2_000, mandate: MANDATE, price_band: { min: 0, max: 1_000_000 },
      giver: GIVER.household,
      candidates: [{ product: "miso-a", quantity: 1, predicted_conversion: 0.5, is_exploration: true, given_by: null }],
    } as never);
    await presentGift(s.engine, gift.id, s.T, GIVER);
    expect((await s.decideAll(gift.id, "returned")).state).toBe("decided");

    // §12 defaults what the recipient never answered. It answered.
    const late = s.T + 3_000;
    s.engine.sweep(late);
    const after = s.engine.mustGet(gift.id, late);
    expect(after.candidates.map((c) => c.valence)).toEqual(["returned"]);

    // The settlement still refuses while the hub is silent (§16.5), so
    // nothing settles under a window that was not read; what does not happen
    // is a charge. Once the hub answers, the refusal settles at nothing.
    await expect(s.engine.settle(gift.id, late)).rejects.toMatchObject({ code: "hub_refused" });
    s.era.old = false;
    expect((await s.engine.settle(gift.id, late)).charged).toBe(0);
    expect(s.engine.paymentsBy(GIVER.household).map((p) => p.charged)).toEqual([0]);
  });

  test("a household's own set is decided, and a courier's collection recorded", async () => {
    const s = split();
    await s.setUp();
    const own = s.own();
    await s.engine.present(own.id, s.T);
    expect((await s.decideAll(own.id, "kept")).state).toBe("decided");

    const box = s.engine.createOffer({
      binding: "physical", household: HOUSEHOLD, purpose: "replenish", config_version: CONFIG_VERSION,
      expires_at: s.T + DAY, mandate: MANDATE, price_band: null, giver: null,
      candidates: [{ product: "nori-a", quantity: 1, predicted_conversion: 0.5, is_exploration: true, given_by: null }],
    } as never);
    await s.engine.present(box.id, s.T);
    s.deliveries.record({ offer: box.id, carriage: 0, code: `dc-${box.id.slice(0, 8)}`, status: "delivered" });
    await s.engine.collect({ offer: box.id, returned: [], consumed: [box.candidates[0]!.id], at: s.T + 1 });
    expect(s.engine.mustGet(box.id, s.T + 1).state).toBe("decided");
  });

  test("a hub that is not there refuses a presentation and a settlement, and not a decision", async () => {
    // NOTE (mutation check, 2026-09-20): unreachable_hub_is_no_ceiling. The
    // presentation assertion read `presented`: an offer of 1,200 entirely
    // outside the network presented past a ceiling of 0, because the engine
    // could not reach the hub that holds it.
    //
    // `hub_unreachable` and `hub_refused` are named in §13.1 and §16.2 and
    // were asserted nowhere, in the suites or here, until 2026-09-20. **No
    // conformance probe can reach either**: the suites' engine-only
    // deployment is pointed at a hub-only deployment that is up, and
    // producing one that is down or answering 500 needs a deployment the
    // conformance contract does not ask an implementation for.
    const s = split({ cooling_seconds: 60 });
    await s.setUp();
    // Two offers presented while the hub answers, so that the decision below
    // has somewhere to land once it stops.
    const decided = s.own("tea-b");
    const settling = s.own("coffee-a");
    await s.engine.present(decided.id, s.T);
    await s.engine.present(settling.id, s.T);
    await s.decideAll(settling.id, "kept");

    // The hub goes away: the socket refuses, which is what `fetch` throws.
    const dead = () => Promise.reject(new Error("connect ECONNREFUSED"));
    s.engine.readMandatesFrom(new RemoteMandates("http://hub.example", dead as never));
    await expect(s.engine.present(s.own("nori-a").id, s.T)).rejects.toMatchObject({ code: "hub_unreachable" });
    await expect(s.engine.settle(settling.id, s.T + 61_000)).rejects.toMatchObject({ code: "hub_unreachable" });
    // A decision is the one thing that proceeds, because the message it
    // carries is usually the person saying no.
    expect((await s.decideAll(decided.id, "returned")).state).toBe("decided");

    // A hub that answers and refuses is the other half of the same sentence.
    s.engine.readMandatesFrom(new RemoteMandates("http://hub.example", (() => new Response("", { status: 503 })) as never));
    await expect(s.engine.present(s.own("miso-a").id, s.T)).rejects.toMatchObject({ code: "hub_refused" });
  });

  test("one silence does not drop the other reading", async () => {
    // NOTE (mutation check, 2026-09-20): one_silence_drops_the_other. The
    // settlement assertion read `charged 900`: a single catch over both reads
    // loses the ceiling the set was decided under whenever the window cannot
    // be read, which on this hub is every decision.
    //
    // The hub answers `ceiling_daily` (question 60) and not `cooling_seconds`
    // (question 68), so each read stands on its own and the ceiling is
    // recorded. The mandate then lapses, the hub is brought up to date, and
    // the recorded 500 is what refuses.
    const s = split({ ceiling_daily: 500, lapses_at: Date.now() + 60_000 });
    await s.setUp();
    const own = s.own("tea-b");
    await s.engine.present(own.id, s.T);
    await s.decideAll(own.id, "kept");
    s.era.old = false;
    await expect(s.engine.settle(own.id, s.T + 61_000)).rejects.toMatchObject({ code: "mandate_ceiling_daily" });
  });
});
