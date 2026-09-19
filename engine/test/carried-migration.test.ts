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
  test("is marked once on first open where the ledger keeps its rows", async () => {
    // NOTE (mutation check, 2026-09-19): carried_marker_not_migrated.
    const dir = mkdtempSync(join(tmpdir(), "valence-migration-"));
    try {
      const path = join(dir, "store.sqlite");
      await writeAsBeforeTheMarker(path);
      const store = openStore(path);
      const engine = new ValenceEngine(new InMemoryLedger(store), options, store);
      expect(engine.paymentsBy(giver).map((p) => p.offer)).toEqual(["own"]);
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("is left unmarked where the ledger kept no reservation for any settlement", async () => {
    // NOTE (mutation check, 2026-09-19): migration_trusts_an_empty_ledger.
    // The reference ledger was kept in memory until 2026-09-19 even where the
    // store was on disk, so a store from before that has settlements and no
    // reservations; the pass marked every settlement the host had made.
    const dir = mkdtempSync(join(tmpdir(), "valence-migration-"));
    try {
      const path = join(dir, "store.sqlite");
      await writeAsBeforeTheMarker(path);
      const db = new Database(path);
      db.run(`drop table "reservations"`);
      db.close();
      const store = openStore(path);
      const engine = new ValenceEngine(new InMemoryLedger(store), options, store);
      expect(engine.paymentsBy(giver).map((p) => p.offer).sort()).toEqual(["own", "planted"]);
      store.close();
      const check = new Database(path);
      expect(check.query(`select count(*) as n from "migrations"`).get()).toEqual({ n: 0 });
      check.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("is left unmarked, and says so, where the ledger forgets its rows", async () => {
    const dir = mkdtempSync(join(tmpdir(), "valence-migration-"));
    try {
      const path = join(dir, "store.sqlite");
      await writeAsBeforeTheMarker(path);
      const store = openStore(path);
      const engine = new ValenceEngine(new InMemoryLedger(), options, store);
      // Unmarked: the ledger cannot say, so nothing is guessed.
      expect(engine.paymentsBy(giver).map((p) => p.offer).sort()).toEqual(["own", "planted"]);
      store.close();
      const db = new Database(path);
      expect(db.query(`select count(*) as n from "migrations"`).get()).toEqual({ n: 0 });
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
