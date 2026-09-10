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

  test("the two actions under an offer that carry the person's authority are the hub's", () => {
    // The path is the offer's because the offer is what they concern. The
    // authority is the person's: a signature, a withdrawal, and the
    // household's own delivery surface (§7.5b).
    expect(ownerOf(parts("/offers/x/decisions"))).toBe("hub");
    expect(ownerOf(parts("/offers/x/delivery"))).toBe("hub");
    // and their neighbours under the same path are not
    expect(ownerOf(parts("/offers/x/settle"))).toBe("engine");
    expect(ownerOf(parts("/offers/x/withdraw"))).toBe("engine");
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
    expect(answersFor(engineOnly, parts("/offers/x/decisions"))).toBe(false);
    // and still answers the registry, which is neither role's
    expect(answersFor(engineOnly, parts("/registry"))).toBe(true);
  });

  test("a hub alone does not answer for the engine's surface", () => {
    expect(answersFor(hubOnly, parts("/households/h/export"))).toBe(true);
    expect(answersFor(hubOnly, parts("/offers/x/decisions"))).toBe(true);
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
