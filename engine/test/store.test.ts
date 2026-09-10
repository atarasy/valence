import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inMemoryStore, openStore } from "../src/common/store.js";

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
