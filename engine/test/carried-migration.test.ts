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

function writeAsBeforeTheMarker(path: string) {
  const store = openStore(path);
  const engine = new ValenceEngine(new InMemoryLedger(store), options, store);
  engine.importOffer({ id: "planted", household: recipient, mandate: `${recipient}.1`, presenter: "p", giver,
    purpose: "ceremonial", binding: "digital", state: "settled", candidates: [{ id: "planted-c", valence: "kept" }] } as never, recipient);
  engine.importSettlement({ offer: "planted", settled_at: 3, charged: 999_999, payer: giver, signed_by: "p", receipt: "r" } as never);
  store.close();
  // What an engine from before the marker left on disk: the settlement, and
  // neither the marker nor the record that the pass has run.
  const db = new Database(path);
  db.run(`drop table "carried_settlements"`);
  db.run(`drop table "migrations"`);
  db.close();
}

describe("question 66: a store from before the marker", () => {
  test("is marked once on first open where the ledger keeps its rows", () => {
    // NOTE (mutation check, 2026-09-19): carried_marker_not_migrated.
    const dir = mkdtempSync(join(tmpdir(), "valence-migration-"));
    try {
      const path = join(dir, "store.sqlite");
      writeAsBeforeTheMarker(path);
      const store = openStore(path);
      const engine = new ValenceEngine(new InMemoryLedger(store), options, store);
      expect(engine.paymentsBy(giver)).toEqual([]);
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("is left unmarked, and says so, where the ledger forgets its rows", () => {
    const dir = mkdtempSync(join(tmpdir(), "valence-migration-"));
    try {
      const path = join(dir, "store.sqlite");
      writeAsBeforeTheMarker(path);
      const store = openStore(path);
      const engine = new ValenceEngine(new InMemoryLedger(), options, store);
      // Unmarked: the ledger cannot say, so nothing is guessed.
      expect(engine.paymentsBy(giver).map((p) => p.offer)).toEqual(["planted"]);
      store.close();
      const db = new Database(path);
      expect(db.query(`select count(*) as n from "migrations"`).get()).toEqual({ n: 0 });
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
