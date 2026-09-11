import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inMemoryStore, openStore } from "../src/common/store.js";
import { ValenceEngine, canonicalConfig } from "../src/engine/offers.js";
import { InMemoryLedger } from "../src/engine/ledger.js";
import { generateKeyPairSync, sign } from "node:crypto";

const fresh = () => join(mkdtempSync(join(tmpdir(), "valence-store-")), "db.sqlite");

describe("a store is a map that writes through", () => {
  test("what was written is there after the process that wrote it is gone", () => {
    // The whole point. Everything above this line has been in memory since the
    // engine was written, and a restart was a loss.
    const path = fresh();
    const first = openStore(path);
    const offers = first.map<{ id: string; state: string }>("offers");
    offers.set("o-1", { id: "o-1", state: "presented" });
    offers.set("o-2", { id: "o-2", state: "settled" });
    offers.delete("o-2");
    first.close();

    const second = openStore(path);
    const reopened = second.map<{ id: string; state: string }>("offers");
    expect(reopened.get("o-1")).toEqual({ id: "o-1", state: "presented" });
    expect(reopened.has("o-2")).toBe(false);
    expect(reopened.size).toBe(1);
    second.close();
  });

  test("it is a Map, so nothing that reads one has to change", () => {
    // The reads in this engine are synchronous and their shape is the state
    // machine's. Reaching a database through them would push `await` into
    // §2.1, so the rows stay in memory and only the writes go to disk.
    const store = openStore(":memory:");
    const m = store.map<number>("counts");
    m.set("a", 1);
    expect(m instanceof Map).toBe(true);
    expect([...m.keys()]).toEqual(["a"]);
    expect(m.get("a")).toBe(1);
    store.close();
  });

  test("two maps over one table would diverge, so the second is refused", () => {
    const store = openStore(":memory:");
    store.map("offers");
    expect(() => store.map("offers")).toThrow(/opened twice/);
    store.close();
  });

  test("an offer moved through its states is in the state it was moved to", async () => {
    // Written 2026-09-11, after a restart against the same file returned an
    // offer that had been presented as `drafted`. The test above passed the
    // whole time, because it writes a row with `set` and reads it back, and
    // every state transition in this engine assigns a field of a value the
    // map handed out. A map cannot see that, so the disk never heard.
    //
    // **This is the only kind of test that can ask.** A conformance probe
    // talks HTTP to a running process and cannot outlive it.
    const path = fresh();
    const pair = generateKeyPairSync("ed25519");
    const config = {
      version: "cfg-restart",
      presenter: "merchant-restart",
      products: {
        "tea-a": { merchant: "maker-a", maker: "made-by-tea", ships: "carrier-a", price: 1200 },
        "tea-b": { merchant: "maker-a", maker: "made-by-tea", ships: "carrier-a", price: 900 },
      },
    };

    const before = openStore(path);
    const first = new ValenceEngine(new InMemoryLedger(), { explorationRate: 0.2, reminderLimit: 1, recoveryGraceDays: 3, relyingPartyId: "unit.example" }, before);
    first.registerIdentity(
      "merchant-restart",
      pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
      true
    );
    first.registerConfig(config, sign(null, canonicalConfig(config), pair.privateKey).toString("base64"));
    const offer = first.createOffer({
      binding: "digital",
      household: "house-restart",
      purpose: "replenish",
      config_version: "cfg-restart",
      expires_at: Date.now() + 3600_000,
      mandate: "mandate-restart",
      price_band: null,
      giver: null,
      candidates: [
        { product: "tea-a", quantity: 1, predicted_conversion: 0.5, is_exploration: true, given_by: null },
        { product: "tea-b", quantity: 1, predicted_conversion: 0.5, is_exploration: true, given_by: null },
      ],
    });
    await first.present(offer.id);
    expect(first.mustGet(offer.id).state).toBe("presented");
    before.close();

    const after = openStore(path);
    const second = new ValenceEngine(new InMemoryLedger(), { explorationRate: 0.2, reminderLimit: 1, recoveryGraceDays: 3, relyingPartyId: "unit.example" }, after);
    expect(second.mustGet(offer.id).state).toBe("presented");
    after.close();
  });

  test("no path means no disk, which is what the suites run against", () => {
    const store = inMemoryStore();
    const m = store.map<number>("anything");
    m.set("a", 1);
    expect(m.get("a")).toBe(1);
    // A second map over the same name is a different map here, because there
    // is no table for them to share.
    expect(store.map<number>("anything").size).toBe(0);
  });
});
