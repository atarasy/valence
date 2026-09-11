import { describe, expect, test } from "bun:test";
import { LocalMandates, RemoteMandates } from "../src/engine/mandate-source.js";
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
    const source = new LocalMandates({ get: (id) => rows.get(id) });
    expect(await source.get("m-1")).toEqual(mandate);
    expect(await source.get("m-2")).toBeUndefined();
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
