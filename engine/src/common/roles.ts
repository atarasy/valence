/**
 * §13.1. The two roles an implementation may present.
 *
 * An implementation may run the engine's surface, the hub's surface, or both,
 * and it is judged on the surface it presents. This file is the one place
 * that says which role owns which route, so that the answer is a table rather
 * than a property of where an `if` happens to sit in the router.
 *
 * The hard case is `delivery`. It lives under an offer's path and is the
 * household's surface by §7.5b: a merchant must not read a carrier's code,
 * because the code resolves to an address. So the path is the offer's and the
 * role is the hub's, and a hub holds deliveries without holding offers.
 *
 * `decisions` was here too until 2026-09-11, on the reasoning that it carries
 * the person's authority. **Authority travels in the signature, not in the
 * route.** Clause 35 makes a decided set the person's because they signed it,
 * and whoever answers the route cannot forge that. What answering the route
 * does need is the offer, which a hub does not have: a hub alone answered
 * `decisions` and could only ever reply that it had never heard of the offer.
 * Tested rather than reasoned, on the day the split was built.
 */
export type Role = "engine" | "hub";

/** A route either belongs to one role, or is answered by whichever runs. */
export type Owner = Role | "either";

/** §7.5b. The action on an offer that the hub answers, not the engine. */
const HUB_OFFER_ACTIONS = new Set(["delivery"]);

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
