import { inMemoryStore, type Store } from "../common/store.js";
import { badRequest, conflict, notFound, unprocessable } from "../common/errors.js";
import type { Candidate, Offer, PhysicalEligibility, Recovery } from "../common/types.js";

/**
 * The physical binding's operations, which the valences alone do not give you.
 *
 * §11 of the specification. Goods sit in a household's home, the presenter
 * comes back for what was not used, and what is not recovered becomes a loss
 * to whoever holds the stock. None of that is expressible as a decision by the
 * household, which is why it lives here rather than in `decide`.
 *
 * The rule that shapes the file: **a household is never billed for `lost`**
 * (§3.2). Loss is an operating metric, and an implementation that turns it
 * into a receivable has replaced the trust model with a deposit.
 */

/** §11.2, question 46. The longest note a missing item may carry. */
export const MISSING_NOTE_LIMIT = 500;

/** §11.1. Eligible for placement in a home, or not, and why not. */
export function ineligibleReason(
  eligibility: PhysicalEligibility | undefined,
  offerPeriodDays: number
): string | null {
  if (!eligibility) {
    return "no eligibility recorded for this product";
  }
  if (eligibility.regulated) {
    // Alcohol and medicines are out of scope entirely, whatever else holds.
    return "a regulated category is out of scope for the physical binding";
  }
  if (!eligibility.ambient) {
    return "chilled and frozen goods are out of scope for the physical binding";
  }
  if (!eligibility.fits_ten_per_container) {
    return "ten do not fit in one container";
  }
  if (eligibility.keeps_for_days < offerPeriodDays * 3) {
    return `keeps for ${eligibility.keeps_for_days} days, and the offer runs ${offerPeriodDays}`;
  }
  return null;
}

/**
 * Whether a recovered item may go back out to someone else.
 *
 * §11 permits it only for unopened, ambient goods inside the freshness window,
 * with a temperature record where the category requires one. This returns the
 * decision and the reason, because "not eligible" and "eligible" are both
 * things an operator has to be able to show afterwards.
 */
export function redistributable(input: {
  eligibility: PhysicalEligibility | undefined;
  unopened: boolean;
  daysOfFreshnessLeft: number;
  temperatureRecord: boolean;
  requiresTemperatureRecord: boolean;
}): { ok: boolean; reason: string } {
  if (!input.unopened) return { ok: false, reason: "opened" };
  if (!input.eligibility?.ambient) return { ok: false, reason: "not ambient" };
  if (input.daysOfFreshnessLeft <= 0) {
    return { ok: false, reason: "outside the freshness window" };
  }
  if (input.requiresTemperatureRecord && !input.temperatureRecord) {
    return { ok: false, reason: "no temperature record for a category that requires one" };
  }
  return { ok: true, reason: "unopened, ambient, in date" };
}

export class RecoveryLedger {

  /** §13.2. Where this register keeps what it holds. Unset is in memory. */
  constructor(store: Store = inMemoryStore()) {
    this.rows = store.map("recoveries");
  }

  private readonly rows: Map<string, Recovery>;

  /** Opened at presentation, because the deadline runs from the placement. */
  open(input: { offer: string; dueAt: number; graceDays: number }): Recovery {
    if (this.rows.has(input.offer)) {
      throw conflict("recovery_open", "this offer already has a recovery");
    }
    const row: Recovery = {
      offer: input.offer,
      due_at: input.dueAt,
      grace_days: input.graceDays,
      collected_at: null,
      returned: [],
      consumed: [],
      missing: [],
      missing_notes: {},
    };
    this.rows.set(input.offer, row);
    return row;
  }

  /**
   * Records a collection.
   *
   * The presenter reports what came back unopened, what was used, and, since
   * question 46, what was not in the box, with a note for each. Every rule of
   * §11.2 is checked here and not only on the HTTP route, because a review
   * pass on 2026-09-14 measured an in-process caller leaving a box open for
   * good through this method. The order of the refusals is §11.2's, so that a
   * body breaking two rules names the same one on every implementation.
   */
  collect(input: {
    offer: string;
    /** The offer's candidates as they stand now, which the rules are read against. */
    candidates: readonly Pick<Candidate, "id" | "valence">[];
    returned: string[];
    consumed: string[];
    missing?: string[];
    missing_notes?: Record<string, string>;
    at: number;
  }): Recovery {
    const row = this.rows.get(input.offer);
    if (!row) throw notFound(`no recovery open for offer ${input.offer}`);
    const missing = input.missing ?? [];
    const notes = input.missing_notes ?? {};
    const named = [...input.returned, ...input.consumed, ...missing];
    const known = new Set(input.candidates.map((c) => c.id));
    // §11.2. A collection names candidates of this offer. An id belonging to
    // no candidate resolved nothing and still read as goods used.
    const strangers = named.filter((id) => !known.has(id));
    if (strangers.length > 0) {
      throw unprocessable("unknown_candidate", `not candidates of this offer: ${strangers.join(", ")}`);
    }
    // One item, one verdict. The same id twice in one list is two verdicts too.
    const repeated = named.filter((id, i) => named.indexOf(id) !== i);
    if (repeated.length > 0) {
      throw unprocessable(
        "returned_and_consumed",
        `a candidate cannot carry two verdicts in one collection: ${[...new Set(repeated)].join(", ")}`
      );
    }
    // Question 46, R2. A note belongs to a missing item and nothing else; a
    // note for another id is a malformed body, checked here so an in-process
    // caller meets it too (a refutation pass on 2026-09-14 found the route held
    // the only copy and dropped a stray note in silence).
    const stray = Object.keys(notes).filter((id) => !missing.includes(id));
    if (stray.length > 0) {
      throw badRequest("malformed", `notes for items not named missing: ${stray.join(", ")}`);
    }
    // A loss the stock holder bears arrives with a reason. The length is
    // counted in characters (code points), which is what §11.2 says.
    const unexplained = missing.filter((id) => {
      const note = notes[id];
      return typeof note !== "string" || note.trim() === "" || [...note].length > MISSING_NOTE_LIMIT;
    });
    if (unexplained.length > 0) {
      throw unprocessable(
        "missing_note_required",
        `each missing item needs a note of 1 to ${MISSING_NOTE_LIMIT} characters: ${unexplained.join(", ")}`
      );
    }
    if (row.collected_at !== null) {
      throw conflict("already_collected", "this offer has already been collected");
    }
    // Question 46, R3. The collection may overrule a household's `returned`,
    // because what came back is the collection's to find, and nothing else a
    // candidate already carries. The valence is named so a line the deadline
    // made `lost` is not blamed on the household.
    const decided = input.candidates.filter(
      (c) => c.valence !== "offered" && c.valence !== "returned" && named.includes(c.id)
    );
    if (decided.length > 0) {
      throw unprocessable(
        "candidate_decided",
        `already decided, and not a collection's to change: ${decided.map((c) => `${c.id} (${c.valence})`).join(", ")}`
      );
    }
    // The deadline makes an item lost only while nothing was collected, and a
    // second collection is refused, so an undecided item left unnamed would
    // stay `offered` and the box would never close.
    const unnamed = input.candidates.filter((c) => c.valence === "offered" && !named.includes(c.id));
    if (unnamed.length > 0) {
      throw unprocessable(
        "collection_incomplete",
        `name every undecided item as returned, consumed or missing: ${unnamed.map((c) => c.id).join(", ")}`
      );
    }
    row.returned = [...input.returned];
    row.consumed = [...input.consumed];
    row.missing = [...missing];
    row.missing_notes = Object.fromEntries(missing.map((id) => [id, notes[id]!]));
    row.collected_at = input.at;
    // A store's map writes through on `set` and cannot see a field being
    // assigned, so the row goes back (see `OfferRegister.commit`).
    this.rows.set(input.offer, row);
    return row;
  }

  for(offer: string): Recovery | undefined {
    return this.rows.get(offer);
  }

  /**
   * §14.2, §6.5. Take the rows a move carried.
   *
   * **A row this host already holds is never replaced**, for the reason
   * §14.2 gives for offers: an import adds what the host does not have, and a
   * receiving host that overwrote its own record of a collection would let
   * whoever composed the export decide what a box came back with.
   */
  importRows(rows: readonly Recovery[]): void {
    for (const row of rows) {
      if (this.rows.has(row.offer)) continue;
      this.rows.set(row.offer, {
        ...row,
        returned: [...row.returned],
        consumed: [...row.consumed],
        // An export written before question 46 carries no `missing`.
        missing: [...(row.missing ?? [])],
        missing_notes: { ...(row.missing_notes ?? {}) },
      });
    }
  }

  /** Past the deadline and the grace period, with nothing collected. */
  overdue(offer: string, now: number): boolean {
    const row = this.rows.get(offer);
    if (!row || row.collected_at !== null) return false;
    return now > row.due_at + row.grace_days * 86_400_000;
  }
}

/**
 * What each candidate of a physical offer becomes, given the recovery.
 *
 * Undecided and uncollected past the deadline is `lost`, and `lost` is never
 * charged. Undecided and collected unopened is `returned`. The household's own
 * decisions are left alone: this only fills in what the household never said.
 */
export function applyRecovery(
  offer: Offer,
  recovery: Recovery | undefined,
  now: number
): void {
  if (offer.binding !== "physical") return;
  const overdue =
    recovery !== undefined &&
    recovery.collected_at === null &&
    now > recovery.due_at + recovery.grace_days * 86_400_000;

  for (const candidate of offer.candidates) {
    // Question 46, R3. A household's `returned` gives way to what the
    // collection found used or gone; nothing else the household said does.
    // A row stored before question 46 has no `missing`; the store hands it
    // back as written, so this reads it as nothing missing.
    const overruled =
      candidate.valence === "returned" &&
      recovery !== undefined &&
      recovery.collected_at !== null &&
      (recovery.consumed.includes(candidate.id) || (recovery.missing ?? []).includes(candidate.id));
    if (candidate.valence !== "offered" && !overruled) continue;
    if (recovery?.returned.includes(candidate.id)) {
      candidate.valence = "returned";
      candidate.decided_at = recovery.collected_at ?? now;
    } else if (recovery?.consumed.includes(candidate.id)) {
      candidate.valence = "consumed";
      candidate.decided_at = recovery.collected_at ?? now;
    } else if (recovery?.missing?.includes(candidate.id)) {
      // Question 46. The route found it gone: the same loss the deadline
      // records, recorded when it was found rather than when time ran out.
      candidate.valence = "lost";
      candidate.decided_at = recovery.collected_at ?? now;
    } else if (overdue) {
      candidate.valence = "lost";
      candidate.decided_at = now;
    }
  }
}
