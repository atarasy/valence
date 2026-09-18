import { describe, expect, test } from "bun:test";
import { openStore, inMemoryStore, type Store } from "../src/common/store.js";
import { ValenceEngine } from "../src/engine/offers.js";
import { InMemoryLedger } from "../src/engine/ledger.js";
import { createApp } from "../src/http.js";
import { ApprovalDesk } from "../src/hub/approval.js";
import { DeliveryRegister } from "../src/hub/delivery.js";
import { RecoveryRegister } from "../src/hub/node.js";
import { PermissionLedger } from "../src/hub/permissions.js";
import { Registry } from "../src/shared/registry.js";
import { houseFor } from "./helpers.js";

// §13.2, question 55. The household is the name of its key.
const H = houseFor("h").household;

/**
 * §14.2, question 51, decided 2026-09-15. A refused import writes nothing.
 *
 * The conformance suites run in memory, and a persistent store fails in a
 * place memory does not: it writes a row to memory and then binds its key to
 * SQLite. So the property is proven here on both stores, through the route.
 */
function host(store: Store) {
  const engine = new ValenceEngine(new InMemoryLedger(), {
    explorationRate: 0.2, reminderLimit: 1, recoveryGraceDays: 3, relyingPartyId: "unit.example",
  }, store);
  const deliveries = new DeliveryRegister(store);
  const handle = createApp(engine, {
    deliveries, approvals: new ApprovalDesk(store), recovery: new RecoveryRegister(store),
    permissions: new PermissionLedger(store), registry: new Registry(store),
  });
  const post = async (household: string, body: unknown) =>
    handle(new Request(`https://unit.example/households/${household}/import`, { method: "POST", body: JSON.stringify(body) }));
  const holds = () => ({
    offer: (engine as unknown as { offers: Map<string, unknown> }).offers.has("o-1"),
    // §14.2, question 56. A move writes a claim, so this is what the body left
    // behind rather than a mandate the household holds.
    mandate: engine.mandates.claimsFor(H).length > 0,
    collection: engine.recoveries.for("o-1") !== undefined,
    delivery: deliveries.forHousehold(["o-1"]).length > 0,
  });
  const receipts = (household: string) =>
    (engine as unknown as { receipts: Map<string, unknown> }).receipts.get(household);
  return { post, holds, receipts };
}

const offer = { id: "o-1", household: H, mandate: `${H}.1`, state: "decided", candidates: [{ id: "c-1", valence: "offered" }] };
const node = (extra: Record<string, unknown>) => ({
  format: "valence-node/6",
  offers: [offer],
  collections: [{ offer: "o-1", due_at: 1, grace_days: 3, collected_at: null, returned: [], consumed: [], missing: [], missing_notes: {} }],
  mandates: [{ id: `${H}.1`, household: H, ceiling_out_of_network: 1, co_signers: [], ceiling_daily: null, cooling_seconds: null, lapses_at: 9e15, version: 1 }],
  deliveries: [{ offer: "o-1", carriage: 500, code: "dc-1", status: "placed", updated_at: 1 }],
  ...extra,
});
const nothing = { offer: false, mandate: false, collection: false, delivery: false };
const everything = { offer: true, mandate: true, collection: true, delivery: true };

for (const [name, open] of [["in memory", () => inMemoryStore()], ["on disk", () => openStore(":memory:")]] as const) {
  describe(`§14.2: a refused import writes nothing (${name})`, () => {
    test("a row whose key is not a string", async () => {
      // NOTE (mutation check, 2026-09-15): import_row_keys_unchecked. On disk
      // the import answered 500 with the offer written; in memory it answered
      // 201. Either way this assertion failed.
      const bad: Record<string, unknown>[] = [
        { offers: [{ ...offer, id: { a: 1 } }] },
        { settlements: [{ offer: { a: 1 } }] },
        { notes: [{ candidate: 5, author: "a", text: "t", shared_with: [], created_at: 1 }] },
        { lineage: [{ id: null, from: H, to: "g" }] },
        { collections: [{ offer: [], due_at: 1, grace_days: 3, collected_at: null, returned: [], consumed: [] }] },
        { mandates: [{ id: ["m"], co_signers: [] }] },
        { deliveries: [{ offer: true, carriage: 1, code: "c", status: "placed", updated_at: 1 }] },
        // A lone surrogate is a string and binds, and bun:sqlite reads it back
        // as the empty string, so rows written under two such keys collapse
        // into one on the next start. Measured 2026-09-15.
        { settlements: [{ offer: "\ud800" }] },
      ];
      for (const extra of bad) {
        const { post, holds } = host(open());
        const r = await post(H, node(extra));
        expect([Object.keys(extra)[0], r.status]).toEqual([Object.keys(extra)[0], 400]);
        expect(holds()).toEqual(nothing);
      }
    });

    test("receipts arrive under the household, not under the path as it was written", async () => {
      // NOTE (mutation check, 2026-09-15): import_receipts_use_the_raw_path
      // files them under the encoded segment. This assertion failed, reading
      // none: a household id that needs encoding lost its receipts on arrival.
      const { post, receipts } = host(open());
      const r = await post(encodeURIComponent(H), { ...node({}), offers: [], collections: [], deliveries: [], mandates: [], receipts: [{ ref: "r-1", at: 1 }] });
      expect(r.status).toBe(201);
      expect(receipts(H)).toEqual([{ ref: "r-1", at: 1 }]);
    });

    test("the verification refuses an offer named twice, before any write can", () => {
      // NOTE (mutation check, 2026-09-18): import_forgets_carried_offers. It
      // survived the sweep of 2026-09-16 through the route, because the write
      // pass's own `already here` check answers identically once the first
      // copy is written and question 53 rolls it back. **The verification pass
      // is what refuses before a row exists**, so it is called here directly:
      // through the route the two are indistinguishable by outcome.
      const engine = new ValenceEngine(new InMemoryLedger(), {
        explorationRate: 0.2, reminderLimit: 1, recoveryGraceDays: 3, relyingPartyId: "unit.example",
      }, open());
      const twice = [offer, { ...offer, candidates: [{ id: "c-2", valence: "offered" }] }] as unknown as Parameters<typeof engine.checkImport>[0];
      expect(() => engine.checkImport(twice, H, [])).toThrow(/already here/);
      expect(() => engine.checkImport([offer] as unknown as typeof twice, H, [])).not.toThrow();
    });

    test("an offer named twice in one body", async () => {
      // NOTE (mutation check, 2026-09-15): import_forgets_carried_offers. The
      // first copy was written before the second was refused.
      const { post, holds } = host(open());
      // The second copy carries a candidate of its own, or the shared candidate
      // identifier refuses it first and the offer check is never reached.
      const r = await post(H, node({ offers: [offer, { ...offer, candidates: [{ id: "c-2", valence: "offered" }] }] }));
      expect(r.status).toBe(409);
      expect(holds()).toEqual(nothing);
    });

    test("a mandate whose identifier is this household's and whose household is not", async () => {
      // NOTE (mutation check, 2026-09-18): import_mandate_any_household. It
      // survived the sweep of 2026-09-16 because every body here carried a
      // mandate whose two halves agreed, and question 55's identifier check
      // refuses the disagreement only when the identifier is somebody else's.
      // An identifier that carries a household proves whose the row claims to
      // be and says nothing about the household written inside it.
      const { post, holds } = host(open());
      const r = await post(H, node({ mandates: [{ id: `${H}.1`, household: "key:" + "A".repeat(42) + "A", ceiling_out_of_network: 1, co_signers: [], ceiling_daily: null, cooling_seconds: null, lapses_at: 9e15, version: 1 }] }));
      expect(r.status).toBe(422);
      expect(await r.json()).toMatchObject({ error: "wrong_household" });
      expect(holds()).toEqual(nothing);
    });

    test("nothing is written before the whole body has been verified", async () => {
      // NOTE (mutation check, 2026-09-18): import_writes_before_verifying and
      // import_skips_delivery_check. Both survived the sweep of 2026-09-16,
      // and neither is a missing probe: question 53 wrapped the import in a
      // transaction, so a body refused after a write rolls back and answers
      // exactly as one refused before the first write. **The rule that is left
      // is the order**, and the order is only visible from inside the store.
      const written: string[] = [];
      const base = open();
      const store = { ...base, map: <V,>(namespace: string) => {
        const inner = base.map<V>(namespace);
        return new Proxy(inner, { get(target, property, receiver) {
          const value = Reflect.get(target, property, receiver);
          if (property === "set" || property === "delete" || property === "clear") {
            return (...args: unknown[]) => { written.push(namespace); return (value as (...a: unknown[]) => unknown).apply(target, args); };
          }
          return typeof value === "function" ? value.bind(target) : value;
        } }) as Map<string, V>;
      } } as Store;
      const { post, holds } = host(store);
      // Two carriages for one offer, which §7.5b refuses, and the deliveries
      // are the last rows the body carries.
      const r = await post(H, node({ deliveries: [
        { offer: "o-1", carriage: 500, code: "dc-1", status: "placed", updated_at: 1 },
        { offer: "o-1", carriage: 800, code: "dc-1", status: "placed", updated_at: 1 },
      ] }));
      expect(r.status).toBe(422);
      expect(await r.json()).toMatchObject({ error: "carriage_fixed" });
      expect(written).toEqual([]);
      expect(holds()).toEqual(nothing);
    });

    test("a delivery the body carries twice with two carriages, then the move put right", async () => {
      // NOTE (mutation check, 2026-09-15): import_skips_delivery_check. The
      // offer, the collection and the mandate were written before the second
      // delivery row was refused, and the retry met the offer as held.
      const { post, holds } = host(open());
      const twice = node({});
      (twice.deliveries as unknown[]).push({ offer: "o-1", carriage: 800, code: "dc-1", status: "placed", updated_at: 2 });
      const r = await post(H, twice);
      expect(r.status).toBe(422);
      expect(holds()).toEqual(nothing);
      const retried = await post(H, node({}));
      expect(retried.status).toBe(201);
      expect(holds()).toEqual(everything);
    });
  });
}
