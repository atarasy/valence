import { describe, expect, test } from "bun:test";
import { answersFor, ownerOf, rolesFrom, type Role } from "../src/common/roles.js";

const parts = (path: string) => path.split("/").filter(Boolean);
const both = new Set<Role>(["engine", "hub"]);
const engineOnly = new Set<Role>(["engine"]);
const hubOnly = new Set<Role>(["hub"]);

describe("§13.1: which role owns a route", () => {
  test("the presenter's surface is the engine's", () => {
    for (const p of ["/offers", "/offers/x", "/offers/x/present", "/offers/x/settle", "/candidates/c/note", "/presenters/p/export", "/_presenter/configs"]) {
      expect(ownerOf(parts(p))).toBe("engine");
    }
  });

  test("the person's surface is the hub's", () => {
    for (const p of ["/households/h/export", "/households/h/permissions", "/_node/mandates", "/lineage/acts", "/lineage/circle"]) {
      expect(ownerOf(parts(p))).toBe("hub");
    }
  });

  test("delivery is the hub's, under an offer's path", () => {
    // §7.5b. A merchant must not read a carrier's code, because the code
    // resolves to an address. A hub holds deliveries without holding offers.
    expect(ownerOf(parts("/offers/x/delivery"))).toBe("hub");
    // and its neighbours under the same path are not
    expect(ownerOf(parts("/offers/x/settle"))).toBe("engine");
    expect(ownerOf(parts("/offers/x/withdraw"))).toBe("engine");
  });

  test("deciding is the engine's, because authority travels in the signature", () => {
    // It was the hub's until 2026-09-11, on the reasoning that a decided set
    // is the person's. It is, and clause 35 makes it so by the signature,
    // which whoever answers the route cannot forge. What answering the route
    // needs is the offer, and a hub does not have one: a hub alone could only
    // ever reply that it had never heard of it.
    expect(ownerOf(parts("/offers/x/decisions"))).toBe("engine");
  });

  test("the registry is neither role's", () => {
    expect(ownerOf(parts("/registry"))).toBe("either");
    expect(ownerOf(parts("/registry/key"))).toBe("either");
  });
});

describe("§13.1: what a deployment answers for", () => {
  test("running both answers for everything", () => {
    for (const p of ["/offers", "/households/h/export", "/registry", "/offers/x/decisions"]) {
      expect(answersFor(both, parts(p))).toBe(true);
    }
  });

  test("an engine alone does not answer for the hub's surface", () => {
    expect(answersFor(engineOnly, parts("/offers/x/settle"))).toBe(true);
    expect(answersFor(engineOnly, parts("/households/h/export"))).toBe(false);
    expect(answersFor(engineOnly, parts("/offers/x/delivery"))).toBe(false);
    expect(answersFor(engineOnly, parts("/offers/x/decisions"))).toBe(true);
    // and still answers the registry, which is neither role's
    expect(answersFor(engineOnly, parts("/registry"))).toBe(true);
  });

  test("a hub alone does not answer for the engine's surface", () => {
    expect(answersFor(hubOnly, parts("/households/h/export"))).toBe(true);
    expect(answersFor(hubOnly, parts("/offers/x/delivery"))).toBe(true);
    expect(answersFor(hubOnly, parts("/offers/x/decisions"))).toBe(false);
    expect(answersFor(hubOnly, parts("/offers"))).toBe(false);
    expect(answersFor(hubOnly, parts("/_presenter/configs"))).toBe(false);
  });
});

describe("§13.1: declaring the roles", () => {
  test("unset is both, which is what the reference runs", () => {
    expect([...rolesFrom(undefined)].sort()).toEqual(["engine", "hub"]);
    expect([...rolesFrom("")].sort()).toEqual(["engine", "hub"]);
  });

  test("one role, or both, named", () => {
    expect([...rolesFrom("hub")]).toEqual(["hub"]);
    expect([...rolesFrom("engine, hub")].sort()).toEqual(["engine", "hub"]);
  });

  test("a name that is not a role is refused rather than ignored", () => {
    // Silently dropping it would start a server presenting a surface nobody
    // asked for, which is the failure this parse exists to prevent.
    expect(() => rolesFrom("hubb")).toThrow();
  });
});
