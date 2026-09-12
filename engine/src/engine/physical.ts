import { inMemoryStore, type Store } from "../common/store.js";
import { conflict, notFound, unprocessable } from "../common/errors.js";
import type { Offer, PhysicalEligibility, Recovery } from "../common/types.js";

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
    };
    this.rows.set(input.offer, row);
    return row;
  }

  /**
   * Records a collection.
   *
   * The presenter reports what came back unopened and what was used. Anything
   * it does not name is neither, and the deadline in `sweep` is what decides
   * that case rather than this call, so a presenter cannot make something
   * `lost` by omitting it from the list.
   */
  collect(input: {
    offer: string;
    returned: string[];
    consumed: string[];
    at: number;
  }): Recovery {
    const row = this.rows.get(input.offer);
    if (!row) throw notFound(`no recovery open for offer ${input.offer}`);
    if (row.collected_at !== null) {
      throw conflict("already_collected", "this offer has already been collected");
    }
    const both = input.returned.filter((id) => input.consumed.includes(id));
    if (both.length > 0) {
      throw unprocessable(
        "returned_and_consumed",
        `a candidate cannot be both returned and consumed: ${both.join(", ")}`
      );
    }
    row.returned = [...input.returned];
    row.consumed = [...input.consumed];
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
    if (candidate.valence !== "offered") continue;
    if (recovery?.returned.includes(candidate.id)) {
      candidate.valence = "returned";
      candidate.decided_at = recovery.collected_at ?? now;
    } else if (recovery?.consumed.includes(candidate.id)) {
      candidate.valence = "consumed";
      candidate.decided_at = recovery.collected_at ?? now;
    } else if (overdue) {
      candidate.valence = "lost";
      candidate.decided_at = now;
    }
  }
}
