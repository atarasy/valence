import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../src/common/store.js";
import { ValenceEngine } from "../src/engine/offers.js";
import { InMemoryLedger } from "../src/engine/ledger.js";
import { houseFor } from "./helpers.js";

/**
 * §14.2, question 66. Where a settlement was made is recorded as it is made,
 * and a store that predates the record says so when it is opened. Two passes
 * that inferred the answer afterwards were refuted: a reservation's absence is
 * not evidence a move carried a settlement, and a store's own emptiness at its
 * first open is not evidence that it predates anything.
 */
const options = { explorationRate: 0.2, reminderLimit: 1 as const, recoveryGraceDays: 3, relyingPartyId: "unit.example" };
const giver = houseFor("migration-giver").household;
const recipient = houseFor("migration-recipient").household;
const planted = { offer: "planted", settled_at: 3, charged: 999_999, payer: giver, signed_by: "p", receipt: "r" };

function open(path: string) {
  const store = openStore(path);
  const engine = new ValenceEngine(new InMemoryLedger(store), options, store);
  return { store, engine };
}
function importPlanted(path: string) {
  const { store, engine } = open(path);
  engine.importOffer({ id: "planted", household: recipient, mandate: `${recipient}.1`, presenter: "p", giver,
    purpose: "ceremonial", binding: "digital", state: "settled", candidates: [{ id: "planted-c", valence: "kept" }] } as never, recipient);
  engine.importSettlement(planted as never);
  store.close();
}
const rows = (path: string, table: string) => {
  const db = new Database(path); const n = db.query(`select count(*) as n from "${table}"`).get() as { n: number }; db.close(); return n.n;
};

describe("question 66: where a settlement was made", () => {
  test("a store opened empty says so, and an imported settlement is never the giver's payment nor reported", async () => {
    // NOTE (mutation check, 2026-09-19): store_predating_the_marker_is_silent
    // and carried_settlement_is_a_payment.
    const dir = mkdtempSync(join(tmpdir(), "valence-provenance-"));
    try {
      const path = join(dir, "store.sqlite");
      const first = open(path);
      first.store.close();
      expect(rows(path, "provenance")).toBe(1);
      importPlanted(path);
      const { store, engine } = open(path);
      expect(engine.paymentsBy(giver)).toEqual([]);
      store.close();
      // The label was written at the first open and is not rewritten by the
      // settlement that followed it.
      expect(rows(path, "provenance")).toBe(1);
      const db = new Database(path);
      expect((db.query(`select v from "provenance"`).get() as { v: string }).v).toContain("recorded from the first settlement");
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a store that already held settlements when the record arrived says it predates it", async () => {
    // NOTE (mutation check, 2026-09-19): store_predating_the_marker_is_silent.
    const dir = mkdtempSync(join(tmpdir(), "valence-provenance-"));
    try {
      const path = join(dir, "store.sqlite");
      importPlanted(path);
      // What a store written before the record looks like on disk.
      const db = new Database(path); db.run(`drop table "provenance"`); db.run(`drop table "settled_here"`); db.close();
      const { store, engine } = open(path);
      // Nothing is guessed in either direction: the settlement is not the
      // giver's payment, because this store cannot say it was made here.
      expect(engine.paymentsBy(giver)).toEqual([]);
      store.close();
      const check = new Database(path);
      expect((check.query(`select v from "provenance"`).get() as { v: string }).v).toContain("predates the record");
      check.close();
      expect(rows(path, "settled_here")).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
