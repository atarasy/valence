import type { Recovery } from "../common/types.js";

/**
 * §11.2, question 48, decided 2026-09-15. What the collection named a
 * candidate, or null where no collection named it. A `lost` line means two
 * different things, not in the box or never collected by the deadline, and
 * the valence alone cannot say which, so a hub drew one sentence covering both.
 * Derived from the collection's record on every read; the candidate record
 * and the exports are unchanged.
 */
export function collectedAs(recovery: Recovery | undefined, candidate: string): "returned" | "consumed" | "missing" | null {
  if (!recovery || recovery.collected_at == null) return null;
  if (recovery.missing.includes(candidate)) return "missing";
  if (recovery.consumed.includes(candidate)) return "consumed";
  if (recovery.returned.includes(candidate)) return "returned";
  return null;
}
