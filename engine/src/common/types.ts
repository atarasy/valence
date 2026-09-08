// Domain types for the Valence Protocol, draft 2026-09-08.
// Section references are to valence/SPEC.md.

export type Binding = "physical" | "digital";

export type Purpose = "gift" | "replenish" | "trial" | "ceremonial" | "assortment";

/** Clause 23. The band a giver chose for a ceremonial gift, in the merchant's currency unit. */
export type PriceBand = { min: number; max: number };

export type OfferState =
  | "drafted"
  | "presented"
  | "decided"
  | "expired"
  | "withdrawn"
  | "settled";

export type Valence =
  | "offered"
  | "kept"
  | "returned"
  | "consumed"
  | "defaulted"
  | "lost";

export type KeptAs = "self" | "gift" | "order";

/**
 * The presenter's catalogue at one version. Frozen onto an offer at creation
 * (§6.3): changing prices mid-flight does not change what an outstanding offer
 * costs.
 *
 * A catalogue entry carries no cost of goods: a sample is free and anything
 * else used is bought at `price` (§6.2, clause 10).
 * settles at (§6.2). It is never returned to a household.
 */
export type CatalogueEntry = {
  /** Clause 11. Who made it: the merchant of record, on every line it appears in. */
  merchant: string;
  /** Clause 12. Who carries it to the household. */
  ships: string;
  price: number;
  /** §11.1. Absent for a product that is never placed in a home. */
  physical?: PhysicalEligibility;
};

export type PresenterConfig = {
  version: string;
  presenter: string;
  products: Record<string, CatalogueEntry>;
};

/**
 * §11.1. What makes a product eligible for the physical binding.
 *
 * Recorded per product on the catalogue rather than judged at offer time,
 * because eligibility is a fact about the goods and the presenter is the party
 * that knows it. An offer that places an ineligible product in someone's home
 * is refused at creation, which is the only point at which refusing it costs
 * nothing.
 */
export type PhysicalEligibility = {
  /** Ambient. Chilled and frozen are out of scope for this binding. */
  ambient: boolean;
  /** Days the product keeps. §11.1 asks for three times the offer period. */
  keeps_for_days: number;
  /** Ten fit in one container, per §11.1. */
  fits_ten_per_container: boolean;
  /** Regulated categories are out of scope entirely, whatever else holds. */
  regulated: boolean;
};

/**
 * §11. What happened to a physical offer after it was presented.
 *
 * Separate from the offer because the offer is what was proposed and this is
 * what the route did. A recovery that never happened is the absence of a row
 * here, and the loss deadline reads that absence.
 */
export type Recovery = {
  offer: string;
  /** When the presenter is due to collect. Set at presentation. */
  due_at: number;
  /** Days after `due_at` before an uncollected candidate becomes `lost`. */
  grace_days: number;
  collected_at: number | null;
  /** Candidates found unopened and taken back. */
  returned: string[];
  /** Candidates the household used while trying, at the merchant's price. Samples settle at zero (§6.2). */
  consumed: string[];
};

export type Candidate = {
  id: string;
  product: string;
  quantity: number;
  /**
   * The merchant's own price, read from the frozen catalogue. There is no
   * request field that sets it, which is how clause 10 is enforced: a
   * presenter, a curator or the platform has no means to raise what a
   * household pays above the merchant's own price (§3.1).
   */
  unit_price: number;
  /** Clauses 11 and 12. Copied from the catalogue with the price; never from the request. */
  merchant: string;
  ships: string;
  predicted_conversion: number | null;
  is_exploration: boolean;
  /**
   * Clause 10, §6.2. Who gave this candidate: a maker, a merchant or a
   * friend, or null when it is goods offered for sale. A gift is never
   * billed to the person who received it; anything else the collection
   * records as `consumed` is bought at the merchant's price. There is no
   * third basis and no cost field.
   */
  given_by: string | null;
  valence: Valence;
  decided_at: number | null;
  kept_as: KeptAs | null;
  lineage: string | null;
};

export type Offer = {
  id: string;
  binding: Binding;
  household: string;
  presenter: string;
  /** §5.4. Whether an identity root endorsed the presenter's key. */
  presenter_attested: boolean;
  purpose: Purpose;
  /** Clause 23. Present on a ceremonial offer, null otherwise. Shown to the recipient. */
  price_band: PriceBand | null;
  /**
   * Clause 25, §12. Who pays a ceremonial offer: the giver, who chose the
   * band. The recipient of a return gift is never the party charged. Present
   * on a ceremonial offer, null otherwise.
   */
  giver: string | null;
  config_version: string;
  presented_at: number | null;
  expires_at: number;
  state: OfferState;
  exploration_floor_met: boolean;
  mandate: string;
  candidates: Candidate[];
  /** §10.4: at most one reminder. Not a rate limit; a hard count. */
  reminders_sent: number;
};

export type Note = {
  candidate: string;
  author: string;
  text: string;
  /** Clause 27. Whom the writer chose to show the line to, beyond themselves. */
  shared_with: NoteParty[];
  created_at: number;
};

export type NoteParty = "recipient" | "merchant";

export type Settlement = {
  offer: string;
  settled_at: number;
  kept_amount: number;
  consumed_amount: number;
  /** Informational. Never billed to the household (§3.2). */
  lost_amount: number;
  /**
   * What the household is billed, and what the ledger commits. §6 requires it
   * to equal kept_amount + consumed_amount.
   *
   * It exists because a breakdown is not a bill. Without this field the
   * settlement reports three amounts and the ledger takes a fourth number
   * nobody can see, and an implementation that quietly added `lost_amount` to
   * the charge passed every probe: the breakdown it returned was correct.
   */
  charged: number;
  /**
   * Clause 11. One line per candidate that was charged or lost, each naming
   * its merchant of record. The presenter signs the receipt as the
   * merchants' disclosed agent, which is what `signed_as` records.
   */
  lines: SettlementLine[];
  /** Clause 25, §12. Who is billed: the giver of a ceremonial offer, the household otherwise. */
  payer: string;
  signed_by: string;
  signed_as: "agent";
  receipt: string;
};

export type SettlementLine = {
  candidate: string;
  product: string;
  merchant: string;
  ships: string;
  valence: Valence;
  amount: number;
};

export type LineageKind = "gift" | "return" | "regift" | "thanks";

export type LineageEdge = {
  id: string;
  from: string;
  to: string;
  product: string;
  merchant: string;
  kind: LineageKind;
  occasion: string;
  receipt: string;
  signature: string;
  /**
   * §7.1, clause 2. Whether the giver's key is endorsed by an identity root,
   * or merely registered here. An unattested edge is recorded and shown as
   * such, and it does not make a product known to the household it names:
   * anyone can register a key, so an unattested edge that counted would let
   * a stranger empty somebody's exploration floor.
   */
  attested: boolean;
  created_at: number;
};
