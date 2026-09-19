import { describe, expect, test } from "bun:test";
import {
  LocalMandates,
  RemoteMandates,
  longestCooling,
  tightestDailyCeiling,
  tightestOutOfNetworkCeiling,
} from "../src/engine/mandate-source.js";
import type { Mandate } from "../src/hub/mandates.js";

const mandate: Mandate = {
  id: "m-1",
  household: "h-1",
  ceiling_out_of_network: 1000,
  ceiling_daily: null,
  cooling_seconds: null,
  co_signers: [],
  lapses_at: Date.now() + 86_400_000,
  version: 1,
};

describe("§13.1: where the engine reads a protection from", () => {
  test("the local source is the register in this process", async () => {
    const rows = new Map([["m-1", mandate]]);
    const source = new LocalMandates({
      get: (id) => rows.get(id),
      forHousehold: (h) => [...rows.values()].filter((m) => m.household === h),
    });
    expect(await source.get("m-1")).toEqual(mandate);
    expect(await source.get("m-2")).toBeUndefined();
    // §16.2, question 56. Which mandates a household has here.
    expect(await source.holdsAny(mandate.household)).toBe(true);
    expect(await source.holdsAny("somebody-else")).toBe(false);
  });

  test("the remote source asks the hub over the endpoint the specification defines", async () => {
    let asked = "";
    const source = new RemoteMandates("http://hub.example/", (async (url: string) => {
      asked = url;
      return new Response(JSON.stringify(mandate), { status: 200 });
    }) as never);
    expect(await source.get("m-1")).toEqual(mandate);
    expect(asked).toBe("http://hub.example/_node/mandates/m-1");
  });

  test("the remote source asks the hub whether a household has any mandate (§16.2)", async () => {
    // NOTE (mutation check, 2026-09-16): remote_mandates_fail_open. Each case
    // below answered `false`, which is the direction that drops the
    // protection: a household that has mandates reads as one that has none,
    // and the phantom-labelled offer presents.
    //
    // Question 56's first half. A refutation pass measured `200 {}` reading as
    // "there are none", so the shape of the answer is checked and not only
    // the transport.
    let asked = "";
    const answering = (body: string, status = 200) =>
      new RemoteMandates("http://hub.example/", (async (url: string) => {
        asked = url;
        return new Response(body, { status });
      }) as never);
    expect(await answering(JSON.stringify({ has: true })).holdsAny("key:h")).toBe(true);
    expect(asked).toBe("http://hub.example/_node/mandates?household=key%3Ah");
    expect(await answering(JSON.stringify({ has: false })).holdsAny("key:h")).toBe(false);
    for (const [what, body, status] of [
      ["an empty object", "{}", 200],
      ["a null field", JSON.stringify({ has: null }), 200],
      ["a string field", JSON.stringify({ has: "yes" }), 200],
      ["a page of HTML", "<!doctype html>", 200],
      ["a route it does not have", "", 404],
      ["a refusal", "", 500],
    ] as const) {
      expect([what, await answering(body, status).holdsAny("key:h").then(() => "answered", (e) => (e as { code: string }).code)])
        .toEqual([what, "hub_refused"]);
    }
  });

  test("the remote source reads a giver's tightest daily ceiling, and silence is not none (§12, §16.3, question 60)", async () => {
    // A hub that predates question 60 answers `has` without `ceiling_daily`.
    // Reading that as "no ceiling" would charge a giver past the ceiling it
    // set, so it refuses instead, as `holdsAny` does for a missing `has`.
    const answering = (body: string, status = 200) =>
      new RemoteMandates("http://hub.example/", (async () => new Response(body, { status })) as never);
    expect(await answering(JSON.stringify({ has: true, ceiling_daily: 500 })).dailyCeilingOf("key:g")).toBe(500);
    expect(await answering(JSON.stringify({ has: false, ceiling_daily: null })).dailyCeilingOf("key:g")).toBeNull();
    for (const [what, body] of [
      ["a hub that predates the field", JSON.stringify({ has: true })],
      ["a negative ceiling", JSON.stringify({ has: true, ceiling_daily: -1 })],
      ["a string ceiling", JSON.stringify({ has: true, ceiling_daily: "500" })],
      ["a fractional ceiling", JSON.stringify({ has: true, ceiling_daily: 1.5 })],
    ] as const) {
      expect([what, await answering(body).dailyCeilingOf("key:g").then(() => "answered", (e) => (e as { code: string }).code)])
        .toEqual([what, "hub_refused"]);
    }
  });

  test("the local source reads the tightest daily ceiling among a household's mandates (question 60)", () => {
    const m = (ceiling_daily: number | null) => ({ ceiling_daily }) as never;
    expect(tightestDailyCeiling([])).toBeNull();
    expect(tightestDailyCeiling([m(null), m(null)])).toBeNull();
    expect(tightestDailyCeiling([m(900), m(null), m(300), m(700)])).toBe(300);
  });

  test("the local source reads the tightest out-of-network ceiling and the longest window (question 68)", async () => {
    // NOTE (mutation check, 2026-09-19): lapsed_mandate_governs_own_offer and
    // lapsed_cooling_governs_own_offer. Each removes the lapse skip from one
    // of the two helpers, and the third case below is the one that catches it.
    //
    // Question 68, decided 2026-09-19. `MandateRegister.record` asks for
    // co-signers only where the identifier already has a row, so a household
    // that had tightened one label recorded a second at version 1, alone,
    // with any values it liked. Every mandate it holds now binds every offer
    // it makes, which is what clause 47 is worth.
    const past = Date.now() - 1_000, future = Date.now() + 86_400_000;
    const m = (ceiling_out_of_network: number, cooling_seconds: number | null, lapses_at = future) =>
      ({ ceiling_out_of_network, cooling_seconds, lapses_at }) as never;
    expect(tightestOutOfNetworkCeiling([])).toBeNull();
    expect(tightestOutOfNetworkCeiling([m(900, null), m(0, null), m(10_000_000, null)])).toBe(0);
    // A lapsed mandate governs nothing, here as in `tightestDailyCeiling`.
    expect(tightestOutOfNetworkCeiling([m(0, null, past), m(10_000_000, null)])).toBe(10_000_000);

    // **The tightest window is the longest one**, which is the one place in
    // §16 where the tighter value is the larger. Null is no window, and is
    // skipped rather than read as zero.
    expect(longestCooling([])).toBeNull();
    expect(longestCooling([m(0, null), m(0, null)])).toBeNull();
    expect(longestCooling([m(0, 60), m(0, null), m(0, 3600), m(0, 1)])).toBe(3600);
    expect(longestCooling([m(0, 3600, past), m(0, 1)])).toBe(1);

    // And the local source reads them from the household's own rows.
    const rows = [
      { ...mandate, id: "h-1.a", ceiling_out_of_network: 0, cooling_seconds: 3600 },
      { ...mandate, id: "h-1.b", ceiling_out_of_network: 10_000_000, cooling_seconds: null },
      { ...mandate, id: "h-2.a", household: "h-2", ceiling_out_of_network: 5, cooling_seconds: 1 },
    ];
    const source = new LocalMandates({
      get: (id) => rows.find((r) => r.id === id),
      forHousehold: (h) => rows.filter((r) => r.household === h),
    });
    expect(await source.outOfNetworkCeilingOf("h-1")).toBe(0);
    expect(await source.coolingSecondsOf("h-1")).toBe(3600);
    expect(await source.outOfNetworkCeilingOf("h-2")).toBe(5);
    expect(await source.outOfNetworkCeilingOf("nobody")).toBeNull();
    expect(await source.coolingSecondsOf("nobody")).toBeNull();
  });

  test("the remote source reads both, and silence is not none either (question 68)", async () => {
    // NOTE (mutation check, 2026-09-19): remote_out_of_network_silence_is_none
    // and remote_cooling_silence_is_none. No conformance probe can reach
    // these: a hub that answers without a field is one no route here can
    // produce, so the rule is proven in `engine/test/` or not at all.
    //
    // A hub that predates question 68 answers `has` and `ceiling_daily` and
    // nothing else. Reading that silence as "no ceiling" and "no window"
    // would present an offer past the ceiling the household set on another of
    // its labels, and settle a set the household could still take back, which
    // is the escape the question closes. So it refuses, as `dailyCeilingOf`
    // does for its own field.
    const answering = (body: string, status = 200) =>
      new RemoteMandates("http://hub.example/", (async () => new Response(body, { status })) as never);
    const full = JSON.stringify({ has: true, ceiling_daily: 500, ceiling_out_of_network: 1200, cooling_seconds: 60 });
    expect(await answering(full).outOfNetworkCeilingOf("key:h")).toBe(1200);
    expect(await answering(full).coolingSecondsOf("key:h")).toBe(60);
    const none = JSON.stringify({ has: false, ceiling_daily: null, ceiling_out_of_network: null, cooling_seconds: null });
    expect(await answering(none).outOfNetworkCeilingOf("key:h")).toBeNull();
    expect(await answering(none).coolingSecondsOf("key:h")).toBeNull();
    for (const [what, body] of [
      ["a hub that predates the fields", JSON.stringify({ has: true, ceiling_daily: null })],
      ["a negative value", JSON.stringify({ has: true, ceiling_out_of_network: -1, cooling_seconds: -1 })],
      ["a string value", JSON.stringify({ has: true, ceiling_out_of_network: "5", cooling_seconds: "5" })],
      ["a fractional value", JSON.stringify({ has: true, ceiling_out_of_network: 1.5, cooling_seconds: 1.5 })],
    ] as const) {
      const code = (e: unknown) => (e as { code: string }).code;
      expect([what, await answering(body).outOfNetworkCeilingOf("key:h").then(() => "answered", code)])
        .toEqual([what, "hub_refused"]);
      expect([what, await answering(body).coolingSecondsOf("key:h").then(() => "answered", code)])
        .toEqual([what, "hub_refused"]);
    }
  });

  test("a hub that answers a mandate in a shape this engine cannot read is not a mandate", async () => {
    // NOTE (mutation check, 2026-09-16): remote_mandate_any_body. A body of
    // `{}` read as a mandate leaves every field undefined, which is a mandate
    // that refuses nothing: the lapse comparison and both ceilings are false.
    const answering = (body: string) =>
      new RemoteMandates("http://hub.example", (async () => new Response(body, { status: 200 })) as never);
    for (const body of ["{}", "<!doctype html>", "null", JSON.stringify({ household: 1 })]) {
      expect([body, await answering(body).get("m-1").then(() => "answered", (e) => (e as { code: string }).code)])
        .toEqual([body, "hub_refused"]);
    }
  });

  test("a hub that answers 404 holds no such mandate, and that is left alone", async () => {
    // The engine leaves an unknown mandate alone rather than refusing every
    // offer under it: a deployment may carry mandates elsewhere, and refusing
    // would be a gate rather than a protection.
    const source = new RemoteMandates("http://hub.example", (async () =>
      new Response("", { status: 404 })) as never);
    expect(await source.get("m-1")).toBeUndefined();
  });

  test("a hub that cannot be reached is not a hub that says there is no mandate", async () => {
    // The direction that matters. Reading a timeout as "no mandate" would drop
    // every protection the moment the network did, which fails open.
    const source = new RemoteMandates("http://hub.example", (async () => {
      throw new Error("connection refused");
    }) as never);
    expect(source.get("m-1")).rejects.toThrow(/could not be reached/);
  });

  test("a hub that refuses is not a hub that says there is no mandate either", async () => {
    const source = new RemoteMandates("http://hub.example", (async () =>
      new Response("", { status: 500 })) as never);
    expect(source.get("m-1")).rejects.toThrow(/answered 500/);
  });
});
