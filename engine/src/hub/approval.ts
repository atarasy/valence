import { inMemoryStore, type Store } from "../common/store.js";
import type { ValenceEngine } from "../engine/offers.js";
import type { Offer, Valence } from "../common/types.js";
import type { Delivery } from "./delivery.js";

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
  /**
   * Clauses 11, 12. The screen the person signs from names who sold it, who
   * made it and who carries it. `maker` reached the candidate, the receipt
   * line and the lineage edge on 2026-09-12 (question 32) and not this
   * surface, while this comment said it did: the fourth time a surface was
   * added without its probe, found by reading the contract in `04b` §2.1
   * against the type.
   */
  merchant: string;
  maker: string;
  ships: string;
  /**
   * Clause 10, §6.2. Who gave this candidate, or null when it is bought. A
   * gift arrives at its price and is never billed, so a screen showing a
   * unit price and no giver asks a person to sign without telling them which
   * lines cost money. Missing until 2026-09-12, found by a refutation pass.
   */
  given_by: string | null;
  id: string;
  product: string;
  quantity: number;
  unit_price: number;
  /** §5.4. Not concealed: a household cannot decline what it cannot see is a guess. */
  is_exploration: boolean;
  /**
   * §11. What this line already is. `offered` is a line waiting on the
   * household; anything else is one the collection or a previous decision has
   * already resolved, and a screen that asks for a choice on it asks for a
   * decision the engine will refuse with `already_decided`.
   *
   * **A physical box is collected line by line and the offer stays
   * `presented`**, so an approval routinely carries both kinds at once. Until
   * 2026-09-12 this surface rendered every candidate identically with nothing
   * to tell them apart, and a hub that required a choice on each could never
   * confirm the lines that were still the household's: found by a refutation
   * pass over the reference hub.
   */
  valence: Valence;
  /** Clause 59. What else the agent considered. */
  alternatives: string[];
  /** Clause 59. The argument against taking it. */
  argument_against: string;
  /**
   * §10a.5. **Which of the screen's blocks governs this line**: the merchant's
   * block for this product where it registered one, and its standing text
   * otherwise. One screen carries several merchants' blocks, and which applies
   * to which line was a rendering instruction in prose until 2026-09-12, so no
   * probe could reach it and a hub could pair any block with any line. Naming
   * it here makes the join a property of the contract. **What is still the
   * hub's** is the visual adjacency: this says which block, not where on the
   * screen it sits.
   */
  disclosure: { merchant: string; product: string | null };
};

/**
 * §10a.5. The block on this offer that governs one line: the merchant's block
 * for that product where the offer carries one, and its standing text
 * otherwise. The two are rendered as signed and never merged, so a label in
 * both governs that line from the product block and every other line from the
 * standing text.
 */
export function governing(
  offer: Offer,
  merchant: string,
  product: string
): { merchant: string; product: string | null } {
  const forProduct = offer.disclosures.some(
    (d) => d.merchant === merchant && d.product === product
  );
  return { merchant, product: forProduct ? product : null };
}

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
  /**
   * §10a.4. One per merchant with a candidate on the offer, as that merchant
   * composed it. **This is the screen a person signs from**, and until
   * 2026-09-12 the disclosures reached `GET /offers/{id}` and stopped there:
   * the requirement was satisfied on a surface the member's hub does not read.
   */
  disclosures: {
    merchant: string;
    /**
     * §10a.5. Null for the merchant's standing text; a product reference for
     * a block about that product alone, which the hub renders beside that
     * product's line, its items prevailing over the standing text's where a
     * label appears in both. Question 35, taken 2026-09-12.
     */
    product: string | null;
    version: string;
    items: { label: string; value: string }[];
    signature: string;
  }[];
  offer: string;
  presenter: string;
  expires_at: number;
  /**
   * §10a.5, §7.5b. What carriage costs, from the delivery the hub recorded
   * for this offer, or null while none is recorded. The block a merchant
   * signed is its standing text; the facts of this sale are the candidates'
   * quantity and unit price beside it, this, and `expires_at`. A screen that
   * carried the block alone would have shown terms and not a sale.
   */
  carriage: number | null;
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

  /** §13.2. Where this register keeps what it holds. Unset is in memory. */
  constructor(store: Store = inMemoryStore()) {
    this.deliberations = store.map("deliberations");
  }

  private readonly deliberations: Map<string, Deliberation>;

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
  render(
    engine: ValenceEngine,
    offer: Offer,
    delivery: Delivery | undefined
  ): Approval | { missing: string } {
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
        maker: c.maker,
        given_by: c.given_by,
        ships: c.ships,
        is_exploration: c.is_exploration,
        valence: c.valence,
        alternatives: entry.alternatives,
        argument_against: entry.argument_against,
        disclosure: governing(offer, c.merchant, c.product),
      });
    }
    return {
      offer: offer.id,
      presenter: offer.presenter,
      expires_at: offer.expires_at,
      carriage: delivery ? delivery.carriage : null,
      reminded: offer.reminders_sent > 0,
      mandate: deliberation.mandate,
      // Clause 23. The band the giver chose is never hidden from the recipient,
      // and the recipient decides on this screen.
      price_band: offer.price_band,
      // §10a.4. Rendered as the merchant composed them, in the merchant's
      // order, which is why this copies rather than sorts.
      disclosures: offer.disclosures.map((d) => ({
        merchant: d.merchant,
        product: d.product,
        version: d.version,
        items: d.items.map((i) => ({ label: i.label, value: i.value })),
        signature: d.signature,
      })),
      candidates,
      excluded: deliberation.excluded,
    };
  }
}
