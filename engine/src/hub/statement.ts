import type { Offer } from "../common/types.js";
import type { Delivery } from "./delivery.js";
import { challengeForStatement, statementLines } from "../shared/statement.js";

/**
 * §6.5. The screen a household signs a physical settlement from, drawn by
 * the hub. Question 36, decided 2026-09-12.
 *
 * Like the approval (clause 54), it carries data and never presentation. It
 * shows the lines the collection's record proposes, each at its price, with
 * the merchant's blocks beside them and the carriage from the hub's own
 * delivery record, so that what the household signs is a sale and not a
 * total. The household confirms it, or disputes consumed lines and signs the
 * rest; it cannot add a verdict of its own (§11.2).
 */
export type Statement = {
  offer: string;
  household: string;
  /**
   * §10a.5 lists the offer's expiry among the facts of a sale, and the
   * approval carries it. The statement did not until a refutation pass on
   * 2026-09-12 asked what a merchant's stated application period is measured
   * against on this screen.
   */
  expires_at: number;
  lines: {
    candidate: string;
    product: string;
    merchant: string;
    maker: string;
    ships: string;
    given_by: string | null;
    valence: "kept" | "defaulted" | "consumed";
    quantity: number;
    unit_price: number;
    amount: number;
  }[];
  /** §10a.4. The merchant's own blocks, as composed, beside the lines. */
  disclosures: {
    merchant: string;
    product: string | null;
    version: string;
    items: { label: string; value: string }[];
    signature: string;
  }[];
  /** §7.5b. From the hub's delivery record, null while none is recorded. */
  carriage: number | null;
  /** §10.5. The challenge for a passkey confirming every line as proposed. */
  challenge: string;
};

export function renderStatement(offer: Offer, delivery: Delivery | undefined): Statement {
  const proposed = statementLines(offer, []);
  return {
    offer: offer.id,
    household: offer.household,
    expires_at: offer.expires_at,
    lines: proposed.map((l) => {
      const c = offer.candidates.find((x) => x.id === l.candidate)!;
      return {
        candidate: c.id,
        product: c.product,
        merchant: c.merchant,
        maker: c.maker,
        ships: c.ships,
        given_by: c.given_by,
        valence: l.valence,
        quantity: c.quantity,
        unit_price: c.unit_price,
        amount: l.amount,
      };
    }),
    disclosures: offer.disclosures.map((d) => ({
      merchant: d.merchant,
      product: d.product,
      version: d.version,
      items: d.items.map((i) => ({ label: i.label, value: i.value })),
      signature: d.signature,
    })),
    carriage: delivery ? delivery.carriage : null,
    challenge: challengeForStatement(offer.id, proposed),
  };
}
