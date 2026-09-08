import type { ValenceEngine } from "../engine/offers.js";
import type { Offer } from "../common/types.js";

/**
 * The approval surface.
 *
 * Clauses 32, 33, 34, 35, 36, 54, 58 and 59, and §10 of the specification.
 * What a household opens, drawn by the hub.
 *
 * It is a separate shape from the offer the presenter created, and the
 * difference is the point. The offer is the merchant's record. This is what a
 * person is asked to sign, and clause 54 says the party drawing it is a party
 * to no transaction. So the contract carries data and never presentation: no
 * markup, no styling, no ordering directive, no image with words burned into
 * it. One such field and the merchant draws the screen after all.
 */
export type ApprovalCandidate = {
  /** Clauses 11, 12. The screen the person signs from names the maker and the carrier. */
  merchant: string;
  ships: string;
  id: string;
  product: string;
  quantity: number;
  unit_price: number;
  /** §5.4. Not concealed: a household cannot decline what it cannot see is a guess. */
  is_exploration: boolean;
  /** Clause 59. What else the agent considered. */
  alternatives: string[];
  /** Clause 59. The argument against taking it. */
  argument_against: string;
};

/**
 * Clause 6 and clause 36. The reason a candidate was left out is one of these
 * and nothing else. A free string would let an agent exclude for any reason
 * and describe it however it liked, which is a routing rule nobody can audit.
 * The list is the published rule set; extending it is a specification change.
 */
export const EXCLUSION_RULES = [
  "auto_renewal",
  "obstructed_cancellation",
  "manufactured_scarcity",
  "late_price",
  "outside_mandate",
  "declined_before",
] as const;
export type ExclusionRule = (typeof EXCLUSION_RULES)[number];

export type Approval = {
  /** Clause 23. The giver's band on a ceremonial offer, null otherwise. */
  price_band: { min: number; max: number } | null;
  offer: string;
  presenter: string;
  expires_at: number;
  /** Clause 33. A boolean, because a count invites a second. */
  reminded: boolean;
  mandate: {
    kind: "standing" | "individual";
    scope: string;
    /** Clause 58. A standing mandate lapses unless renewed. */
    lapses_at: number | null;
  };
  candidates: ApprovalCandidate[];
  /** Clause 36. The reason an order was not executed, shown to the person. */
  excluded: { product: string; reason: ExclusionRule }[];
};

/**
 * What an agent proposes, beyond the offer itself.
 *
 * Clause 59 asks that a proposal carry alternatives and the argument against.
 * Neither is derivable from the offer, so the presenter's agent supplies them
 * and the hub refuses to render an approval without them.
 */
export type Deliberation = {
  offer: string;
  perCandidate: Record<string, { alternatives: string[]; argument_against: string }>;
  excluded: { product: string; reason: ExclusionRule }[];
  mandate: { kind: "standing" | "individual"; scope: string; lapses_at: number | null };
};

export class ApprovalDesk {
  private readonly deliberations = new Map<string, Deliberation>();

  record(deliberation: Deliberation): void {
    this.deliberations.set(deliberation.offer, deliberation);
  }

  deliberationFor(offerId: string): Deliberation | undefined {
    return this.deliberations.get(offerId);
  }

  /**
   * Renders the approval, or refuses.
   *
   * Refusing is the interesting half. An agent that proposes without saying
   * what else it considered and what argues against its proposal has made the
   * household's tap a formality, and clause 59 exists so that it is not one.
   * The hub will not draw a screen that cannot carry both.
   */
  render(engine: ValenceEngine, offer: Offer): Approval | { missing: string } {
    const deliberation = this.deliberations.get(offer.id);
    if (!deliberation) {
      return { missing: "no deliberation recorded for this offer (clause 59)" };
    }
    const candidates: ApprovalCandidate[] = [];
    for (const c of offer.candidates) {
      const entry = deliberation.perCandidate[c.id];
      if (!entry || entry.alternatives.length === 0 || entry.argument_against === "") {
        return {
          missing: `candidate ${c.id} carries no alternatives or no argument against (clause 59)`,
        };
      }
      candidates.push({
        id: c.id,
        product: c.product,
        quantity: c.quantity,
        unit_price: c.unit_price,
        merchant: c.merchant,
        ships: c.ships,
        is_exploration: c.is_exploration,
        alternatives: entry.alternatives,
        argument_against: entry.argument_against,
      });
    }
    return {
      offer: offer.id,
      presenter: offer.presenter,
      expires_at: offer.expires_at,
      reminded: offer.reminders_sent > 0,
      mandate: deliberation.mandate,
      // Clause 23. The band the giver chose is never hidden from the recipient,
      // and the recipient decides on this screen.
      price_band: offer.price_band,
      candidates,
      excluded: deliberation.excluded,
    };
  }
}
