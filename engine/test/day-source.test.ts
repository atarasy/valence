import { describe, expect, test } from "bun:test";
import { HouseholdLedger } from "../src/hub/household-ledger.js";
import { LocalDay, RemoteDay } from "../src/engine/day-source.js";

describe("§16.3: the person's own copy of what settled", () => {
  test("the day's total is the sum since the boundary", () => {
    const ledger = new HouseholdLedger();
    ledger.record({ offer: "a", household: "h", amount: 700, settled_at: 100 });
    ledger.record({ offer: "b", household: "h", amount: 300, settled_at: 200 });
    ledger.record({ offer: "c", household: "other", amount: 900, settled_at: 200 });
    ledger.record({ offer: "d", household: "h", amount: 5000, settled_at: 50 });
    expect(ledger.totalSince("h", 100)).toBe(1000);
  });

  test("a settlement reported twice is one settlement", () => {
    // The engine reports as it settles, and a retry after a timeout must not
    // spend a household's day twice.
    const ledger = new HouseholdLedger();
    ledger.record({ offer: "a", household: "h", amount: 700, settled_at: 100 });
    ledger.record({ offer: "a", household: "h", amount: 700, settled_at: 100 });
    expect(ledger.totalSince("h", 0)).toBe(700);
  });

  test("it carries an amount and a date and nothing about what was bought", () => {
    // A copy carrying products and merchants would be a second vertical ledger
    // on the person's side rather than the person's own.
    const ledger = new HouseholdLedger();
    const row = ledger.record({ offer: "a", household: "h", amount: 700, settled_at: 100 });
    expect(Object.keys(row).sort()).toEqual(["amount", "household", "offer", "settled_at"]);
  });
});

describe("§16.3: asking the hub for the day", () => {
  test("the local source reads the ledger in this process", async () => {
    const ledger = new HouseholdLedger();
    const day = new LocalDay(ledger);
    await day.report({ offer: "a", household: "h", amount: 400, settled_at: 10 });
    expect(await day.totalSince("h", 0)).toBe(400);
  });

  test("the remote source asks the hub over the route the hub answers", async () => {
    let asked = "";
    const day = new RemoteDay("http://hub.example/", (async (url: string) => {
      asked = url;
      return new Response(JSON.stringify({ total: 1200 }), { status: 200 });
    }) as never);
    expect(await day.totalSince("h", 99)).toBe(1200);
    expect(asked).toBe("http://hub.example/households/h/settled?since=99");
  });

  test("a hub that cannot be reached is not a hub that says nothing has settled", async () => {
    // Reading a transport failure as a total of zero would raise every daily
    // ceiling to its full value the moment the network did.
    const day = new RemoteDay("http://hub.example", (async () => {
      throw new Error("connection refused");
    }) as never);
    expect(day.totalSince("h", 0)).rejects.toThrow(/could not be reached/);
  });

  test("an answer with no total is refused rather than read as zero", async () => {
    const day = new RemoteDay("http://hub.example", (async () =>
      new Response(JSON.stringify({}), { status: 200 })) as never);
    expect(day.totalSince("h", 0)).rejects.toThrow(/no total/);
  });

  test("a settlement that could not be reported is not a settlement quietly kept", async () => {
    const day = new RemoteDay("http://hub.example", (async () => {
      throw new Error("connection refused");
    }) as never);
    expect(
      day.report({ offer: "a", household: "h", amount: 1, settled_at: 1 })
    ).rejects.toThrow(/could not be reported/);
  });
});
