// Domain types for the Valence Protocol, draft 2026-09-08.
// Section references are to valence/SPEC.md.

export type Binding = "physical" | "digital";

export type Purpose = "gift" | "replenish" | "trial" | "ceremonial" | "assortment";

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
 * `cost` is the presenter's own cost basis and is what a `consumed` candidate
 * settles at (§6.2). It is never returned to a household.
 */
export type CatalogueEntry = {
  price: number;
  cost: number;
};

export type PresenterConfig = {
  version: string;
  presenter: string;
  products: Record<string, CatalogueEntry>;
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
  predicted_conversion: number | null;
  is_exploration: boolean;
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
  purpose: Purpose;
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
  visibility: "self" | "self_and_recipient";
  created_at: number;
};

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
  receipt: string;
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
  created_at: number;
};
