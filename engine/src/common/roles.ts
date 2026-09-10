/**
 * §13.1. The two roles an implementation may present.
 *
 * An implementation may run the engine's surface, the hub's surface, or both,
 * and it is judged on the surface it presents. This file is the one place
 * that says which role owns which route, so that the answer is a table rather
 * than a property of where an `if` happens to sit in the router.
 *
 * The hard cases are the two actions that live under an offer's path and carry
 * the person's authority. `decisions` is the person's signature and their
 * withdrawal; `delivery` is the household's surface by §7.5b. The path is the
 * offer's because the offer is what they concern; the role is the hub's.
 */
export type Role = "engine" | "hub";

/** A route either belongs to one role, or is answered by whichever runs. */
export type Owner = Role | "either";

/** §16.4, §7.5b. The actions on an offer that the hub answers, not the engine. */
const HUB_OFFER_ACTIONS = new Set(["decisions", "delivery"]);

/**
 * Which role owns a path. `parts` is the path split on "/" with empties
 * dropped, exactly as the router splits it.
 */
export function ownerOf(parts: string[]): Owner {
  const head = parts[0];
  switch (head) {
    case "offers":
      // /offers, /offers/{id}, /offers/{id}/{action}
      return parts.length >= 3 && HUB_OFFER_ACTIONS.has(parts[2]!) ? "hub" : "engine";
    case "candidates":
    case "presenters":
    case "_presenter":
      return "engine";
    case "households":
    case "_node":
    case "lineage":
      return "hub";
    case "registry":
      // Clause 1's neutral infrastructure. Neither role's subject, and a
      // deployment may put it behind either.
      return "either";
    default:
      return "either";
  }
}

/** Whether a deployment running `roles` answers for this path. */
export function answersFor(roles: ReadonlySet<Role>, parts: string[]): boolean {
  const owner = ownerOf(parts);
  return owner === "either" ? roles.size > 0 : roles.has(owner);
}

/** Parse a deployment's declared roles. Absent means both, which is the reference. */
export function rolesFrom(raw: string | undefined): Set<Role> {
  if (raw === undefined || raw.trim() === "") return new Set<Role>(["engine", "hub"]);
  const out = new Set<Role>();
  for (const piece of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    if (piece !== "engine" && piece !== "hub") {
      throw new Error(`VALENCE_ROLES: ${piece} is not a role. Use engine, hub, or both.`);
    }
    out.add(piece);
  }
  if (out.size === 0) {
    throw new Error("VALENCE_ROLES names no role. Leave it unset to run both.");
  }
  return out;
}
