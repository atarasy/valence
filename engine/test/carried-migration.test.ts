import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { openStore } from "../src/common/store.js";
import { ValenceEngine } from "../src/engine/offers.js";
import { InMemoryLedger } from "../src/engine/ledger.js";
import { houseFor } from "./helpers.js";

/**
 * Question 66. A store written before the carried-settlement marker holds
 * carried settlements with nothing to say so. Measured by the second
 * refutation pass: a payment a recipient's import planted came back into its
 * giver's record on upgrade, and the first settle reported it to the day.
 */
const options = { explorationRate: 0.2, reminderLimit: 1 as const, recoveryGraceDays: 3, relyingPartyId: "unit.example" };
const giver = houseFor("migration-giver").household;
const recipient = houseFor("migration-recipient").household;

async function writeAsBeforeTheMarker(path: string) {
  const store = openStore(path);
  const ledger = new InMemoryLedger(store);
  const engine = new ValenceEngine(ledger, options, store);
  engine.importOffer({ id: "planted", household: recipient, mandate: `${recipient}.1`, presenter: "p", giver,
    purpose: "ceremonial", binding: "digital", state: "settled", candidates: [{ id: "planted-c", valence: "kept" }] } as never, recipient);
  engine.importSettlement({ offer: "planted", settled_at: 3, charged: 999_999, payer: giver, signed_by: "p", receipt: "r" } as never);
  // And one the host made, which holds a reservation on this ledger.
  engine.importOffer({ id: "own", household: recipient, mandate: `${recipient}.1`, presenter: "p", giver,
    purpose: "ceremonial", binding: "digital", state: "settled", candidates: [{ id: "own-c", valence: "kept" }] } as never, recipient);
  engine.importSettlement({ offer: "own", settled_at: 4, charged: 1_200, payer: giver, signed_by: "p", receipt: "o" } as never);
  await ledger.reserve({ requestId: "own", household: giver, amount: 1_200, expiresAt: 9e15 });
  store.close();
  // What an engine from before the marker left on disk: the settlement, and
  // neither the marker nor the record that the pass has run.
  const db = new Database(path);
  db.run(`drop table "carried_settlements"`);
  db.run(`drop table "migrations"`);
  db.close();
}

describe("question 66: a store from before the marker", () => {
  test("says once that it cannot tell which settlements a move carried, and marks nothing", async () => {
    // NOTE (mutation check, 2026-09-19): store_predating_the_marker_is_silent.
    // Two passes were written to mark them and both were refuted: a
    // reservation's absence is not evidence a move carried a settlement, on a
    // ledger the reference kept in memory until 2026-09-19, on a host that
    // only imports, or after a sweep. The store says so once instead.
    const dir = mkdtempSync(join(tmpdir(), "valence-migration-"));
    try {
      const path = join(dir, "store.sqlite");
      await writeAsBeforeTheMarker(path);
      const store = openStore(path);
      const engine = new ValenceEngine(new InMemoryLedger(store), options, store);
      // Nothing is guessed, in either direction: the carried one still reads
      // as the giver's payment and the one made here still does.
      expect(engine.paymentsBy(giver).map((p) => p.offer).sort()).toEqual(["own", "planted"]);
      store.close();
      const db = new Database(path);
      expect(db.query(`select count(*) as n from "migrations"`).get()).toEqual({ n: 1 });
      expect(db.query(`select count(*) as n from "carried_settlements"`).get()).toEqual({ n: 0 });
      db.close();
      // And it says it once: a second open writes no second row.
      const again = openStore(path);
      new ValenceEngine(new InMemoryLedger(again), options, again);
      again.close();
      const check = new Database(path);
      expect(check.query(`select count(*) as n from "migrations"`).get()).toEqual({ n: 1 });
      check.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
