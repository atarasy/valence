import { inMemoryStore, type Store } from "../common/store.js";
import { createPublicKey, verify } from "node:crypto";
import { conflict, notFound, unprocessable } from "../common/errors.js";

/**
 * Clauses 46 and 47. A person's standing protections, in a record only that
 * person can loosen, and only with whoever they named beside them.
 *
 * Until 2026-09-09 a mandate was a string an offer carried, so both clauses
 * were promises: nothing held a ceiling, and nothing could tell a loosening
 * from a tightening. What made them checkable was writing down which changes
 * need whose signature.
 */
export type Mandate = {
  id: string;
  household: string;
  /**
   * Clause 46. What may be paid, in one offer, to merchants the registry does
   * not list. The registry is what "in the network" means, and this is the
   * person's own limit on the rest, applied inside their own mandate.
   */
  ceiling_out_of_network: number;
  /** Clause 47. Named while the person has capacity; a loosening needs them all. */
  co_signers: string[];
  /** Clause 58. A standing mandate lapses unless renewed. */
  /** §16.3. What may settle for this household in one day. Null is no ceiling, which 0 is not. */
  ceiling_daily: number | null;
  /** §16.4. Feed categories whose candidates need a co-signer on the decided set. */
  co_sign_categories: string[];
  /** §16.5. How long a decided set waits before it settles. Null is no cooling. */
  cooling_seconds: number | null;
  lapses_at: number;
  version: number;
};

/**
 * What is signed. A version is inside the bytes, so an old signature cannot
 * be replayed onto a new record.
 */
export function canonicalMandate(m: Omit<Mandate, "version"> & { version: number }): Buffer {
  return Buffer.from(
    [
      m.id,
      m.household,
      String(m.ceiling_out_of_network),
      // §16. The three added on 2026-09-10 sit here and not at the end, so the
      // record's order is its own rather than an accident of history. Nothing
      // stored breaks: a signature is checked when its version is submitted
      // and is never retained.
      m.ceiling_daily === null ? "" : String(m.ceiling_daily),
      [...m.co_sign_categories].sort().join(","),
      m.cooling_seconds === null ? "" : String(m.cooling_seconds),
      [...m.co_signers].sort().join(","),
      String(m.lapses_at),
      String(m.version),
    ].join("\n"),
    "utf8"
  );
}

/**
 * A change loosens when it raises the ceiling, drops a co-signer, or pushes
 * the lapse further out. Tightening is the person's alone; loosening needs
 * every co-signer the record named before the change, which is what clause 47
 * means by "signed by both the person and the named family member".
 */
export function loosens(before: Mandate, after: Mandate): boolean {
  if (after.ceiling_out_of_network > before.ceiling_out_of_network) return true;
  if (after.lapses_at > before.lapses_at) return true;
  if (before.co_signers.some((k) => !after.co_signers.includes(k))) return true;
  // §16.1. Removing a category and shortening cooling loosen for the same
  // reason raising a ceiling does: each takes away a protection the person
  // put there, so each needs every co-signer the previous version named.
  if (before.co_sign_categories.some((c) => !after.co_sign_categories.includes(c))) return true;
  if (widens(before.ceiling_daily, after.ceiling_daily)) return true;
  return shortens(before.cooling_seconds, after.cooling_seconds);
}

/** Null is no ceiling, so moving to null widens and moving off it does not. */
function widens(before: number | null, after: number | null): boolean {
  if (after === null) return before !== null;
  if (before === null) return false;
  return after > before;
}

/** Null is no cooling, so moving to null shortens and moving off it does not. */
function shortens(before: number | null, after: number | null): boolean {
  if (after === null) return before !== null;
  if (before === null) return false;
  return after < before;
}

export class MandateRegister {

  /** §13.2. Where this register keeps what it holds. Unset is in memory. */
  constructor(store: Store = inMemoryStore()) {
    this.rows = store.map("mandates");
  }

  private readonly rows: Map<string, Mandate>;

  get(id: string): Mandate | undefined {
    return this.rows.get(id);
  }

  /**
   * Clause 52, and §14.2. A mandate is the person's standing protections, so a
   * move that leaves it behind hands the receiving host a member with no
   * ceiling, no co-signers and no lapse. It was outside the export until
   * 2026-09-09, which is what `exit/` now asks about rather than trusting.
   */
  forHousehold(household: string): Mandate[] {
    return [...this.rows.values()].filter((m) => m.household === household);
  }

  importMandate(m: Mandate): void {
    this.rows.set(m.id, { ...m, co_signers: [...m.co_signers] });
  }

  mustGet(id: string, now = Date.now()): Mandate {
    const m = this.rows.get(id);
    if (!m) throw notFound(`no mandate ${id}`);
    if (m.lapses_at <= now) {
      throw unprocessable("lapsed", `mandate ${id} lapsed and was not renewed`);
    }
    return m;
  }

  /**
   * Record a mandate, or a new version of one. Every version is signed by the
   * household; a version that loosens is signed by every co-signer the
   * previous version named as well.
   */
  record(input: {
    mandate: Mandate;
    signatures: Record<string, string>;
    keyOf: (key: string) => string | undefined;
    now?: number;
  }): Mandate {
    const { mandate, signatures, keyOf } = input;
    const now = input.now ?? Date.now();
    const before = this.rows.get(mandate.id);
    if (before && mandate.version !== before.version + 1) {
      throw conflict(
        "stale_version",
        `mandate ${mandate.id} is at version ${before.version}`
      );
    }
    if (!before && mandate.version !== 1) {
      throw unprocessable("stale_version", "a new mandate starts at version 1");
    }
    if (before && before.household !== mandate.household) {
      throw unprocessable("wrong_household", "a mandate does not change hands");
    }
    if (mandate.lapses_at <= now) {
      throw unprocessable("lapsed", "a mandate that has already lapsed cannot be recorded");
    }

    const required = new Set<string>([mandate.household]);
    if (before && loosens(before, mandate)) {
      // Clause 47. Nothing else changes it: not the person alone, not the
      // co-signer alone, and no layer, which holds no key at all.
      for (const k of before.co_signers) required.add(k);
    }
    const bytes = canonicalMandate(mandate);
    for (const key of required) {
      const pem = keyOf(key);
      const signature = signatures[key];
      if (!pem || !signature) {
        throw unprocessable(
          "unsigned",
          `this change is signed by ${[...required].join(" and ")}; ${key} is missing`
        );
      }
      let ok = false;
      try {
        ok = verify(null, bytes, createPublicKey(pem), Buffer.from(signature, "base64"));
      } catch {
        ok = false;
      }
      if (!ok) {
        throw unprocessable("bad_signature", `the signature of ${key} does not cover this mandate`);
      }
    }
    this.rows.set(mandate.id, mandate);
    return mandate;
  }
}
