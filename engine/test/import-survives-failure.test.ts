import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atomically, inMemoryStore, openStore, type Store } from "../src/common/store.js";
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
 * §14.2, question 53, decided 2026-09-16. An accepted import stands whole or
 * not at all. Question 51 made a refused import write nothing; this is the
 * other failure, the store itself failing between two rows of an import every
 * check has already passed.
 */
const fresh = () => join(mkdtempSync(join(tmpdir(), "valence-q53-")), "db.sqlite");

function host(store: Store) {
  const engine = new ValenceEngine(new InMemoryLedger(), {
    explorationRate: 0.2, reminderLimit: 1, recoveryGraceDays: 3, relyingPartyId: "unit.example",
  }, store);
  const deliveries = new DeliveryRegister(store);
  const handle = createApp(engine, {
    deliveries, approvals: new ApprovalDesk(store), recovery: new RecoveryRegister(store),
    permissions: new PermissionLedger(store), registry: new Registry(store),
  });
  const post = (body: unknown) =>
    handle(new Request(`https://unit.example/households/${H}/import`, { method: "POST", body: JSON.stringify(body) }));
  return { engine, deliveries, post };
}

const node = {
  format: "valence-node/6",
  offers: [{ id: "o-1", household: H, mandate: `${H}.1`, state: "settled", candidates: [{ id: "c-1", valence: "kept" }] }],
  notes: [{ candidate: "c-1", author: "a", text: "t", shared_with: [], created_at: 1 }],
  collections: [{ offer: "o-1", due_at: 1, grace_days: 3, collected_at: null, returned: [], consumed: [], missing: [], missing_notes: {} }],
  mandates: [{ id: `${H}.1`, household: H, ceiling_out_of_network: 1, co_signers: [], ceiling_daily: null, cooling_seconds: null, lapses_at: 9e15, version: 1 }],
  deliveries: [{ offer: "o-1", carriage: 500, code: "dc-1", status: "placed", updated_at: 1 }],
};

describe("§14.2, question 53: an accepted import that fails partway leaves nothing", () => {
  test("on disk and in memory, when the last row cannot be written", async () => {
    // NOTE (mutation check, 2026-09-16): import_writes_outside_a_block drops
    // the block. The offer, the note, the collection and the mandate stood in
    // memory and on disk after the import answered 500, and the retry was
    // refused with 409 because the offer was held.
    const path = fresh();
    const store = openStore(path);
    const h = host(store);
    const real = h.deliveries.importRows.bind(h.deliveries);
    h.deliveries.importRows = () => { throw new Error("disk full"); };
    expect((await h.post(node)).status).toBe(500);
    const inMemory = {
      offer: (h.engine as unknown as { offers: Map<string, unknown> }).offers.has("o-1"),
      note: h.engine.notesFor("c-1").length,
      collection: h.engine.recoveries.for("o-1") !== undefined,
      mandate: h.engine.mandates.get(`${H}.1`) !== undefined,
    };
    expect(inMemory).toEqual({ offer: false, note: 0, collection: false, mandate: false });

    // The same move goes through once the store can write again.
    h.deliveries.importRows = real;
    expect((await h.post(node)).status).toBe(201);
    store.close();

    // And a second process reads the whole move, once.
    const reopened = openStore(path);
    const again = host(reopened);
    expect((again.engine as unknown as { offers: Map<string, unknown> }).offers.has("o-1")).toBe(true);
    expect(again.engine.notesFor("c-1").length).toBe(1);
    // §14.2, question 56. A mandate that arrives by a move is a claim until the
    // household signs it here, so the row this reads back is the claim, and the
    // property under test is that the whole move survived the failure.
    expect(again.engine.mandates.claimFor(`${H}.1`)).toBeDefined();
    expect(again.deliveries.forHousehold(["o-1"]).length).toBe(1);
    reopened.close();
  });

  test("a failure partway leaves the disk as it was for the next process", async () => {
    // NOTE (mutation check, 2026-09-16): atomic_block_skips_the_database. The
    // rows written before the failure were on disk for the next process to
    // read, although memory had been put back.
    const path = fresh();
    const store = openStore(path);
    const h = host(store);
    h.deliveries.importRows = () => { throw new Error("killed"); };
    expect((await h.post(node)).status).toBe(500);
    store.close();
    const reopened = openStore(path);
    const after = host(reopened);
    expect((after.engine as unknown as { offers: Map<string, unknown> }).offers.has("o-1")).toBe(false);
    expect(after.engine.mandates.get(`${H}.1`)).toBeUndefined();
    reopened.close();
  });
});

describe("§13.2: an atomic block", () => {
  test("puts memory back as it was, replacements and deletions included", () => {
    // NOTE (mutation check, 2026-09-16): atomic_block_forgets_memory. The map
    // kept the values written inside the block after it threw.
    for (const store of [inMemoryStore(), openStore(":memory:")]) {
      const m = store.map<number>("counts");
      m.set("kept", 1);
      m.set("gone", 2);
      expect(() => atomically(() => {
        m.set("kept", 10);
        m.delete("gone");
        m.set("new", 3);
        throw new Error("stop");
      })).toThrow("stop");
      expect([...m.entries()].sort()).toEqual([["gone", 2], ["kept", 1]]);
      store.close();
    }
  });

  test("refuses to open inside another, and refuses an asynchronous body", () => {
    expect(() => atomically(() => atomically(() => 1))).toThrow(/already open/);
    expect(() => atomically(() => Promise.resolve(1))).toThrow(/synchronous/);
  });
});
