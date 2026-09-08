import { randomUUID, createHash } from "node:crypto";
import { badRequest, conflict, notFound, unprocessable } from "./errors.js";
import type { Ledger } from "./ledger.js";
import { verifyEdge } from "./lineage.js";
import type {
  Binding,
  Candidate,
  KeptAs,
  LineageEdge,
  LineageKind,
  Note,
  Offer,
  PresenterConfig,
  Purpose,
  Settlement,
  Valence,
} from "./types.js";

export type EngineConfig = {
  /**
   * §5. The exploration rate. It is a deployment parameter with no
   * recommended figure, so there is no default here: an engine constructed
   * without one refuses to start rather than inheriting a number that would
   * become a standard by accident. It must be greater than zero, and there is
   * no setter, so nothing at runtime can reach zero or bypass the check.
   */
  explorationRate: number;
  /** §5.1. A candidate at or below this is eligible to be marked exploration. */
  explorationThreshold: number;
  /** §10.4. At most one reminder. Kept configurable downward, never upward. */
  reminderLimit: 0 | 1;
};

export function explorationFloor(candidateCount: number, rate: number): number {
  return Math.max(1, Math.ceil(candidateCount * rate));
}

export class ValenceEngine {
  private readonly offers = new Map<string, Offer>();
  private readonly notes = new Map<string, Note[]>();
  private readonly settlements = new Map<string, Settlement>();
  private readonly configs = new Map<string, PresenterConfig>();
  private readonly edges = new Map<string, LineageEdge>();
  private readonly identities = new Map<string, string>();
  private readonly receipts = new Map<string, { edge: string; at: number }[]>();
  private readonly candidateIndex = new Map<string, string>();

  readonly config: EngineConfig;

  constructor(
    private readonly ledger: Ledger,
    config: EngineConfig
  ) {
    if (
      typeof config.explorationRate !== "number" ||
      !(config.explorationRate > 0)
    ) {
      throw new Error(
        "explorationRate must be greater than zero (SPEC §5). " +
          "There is no default and no bypass."
      );
    }
    if (config.explorationRate > 1) {
      throw new Error("explorationRate must not exceed 1");
    }
    this.config = { ...config };
    Object.freeze(this.config);
  }

  // ---- presenter catalogue -------------------------------------------------

  registerConfig(config: PresenterConfig): PresenterConfig {
    if (this.configs.has(config.version)) {
      throw conflict("config_exists", `config ${config.version} already exists`);
    }
    this.configs.set(config.version, config);
    return config;
  }

  registerIdentity(key: string, publicKeyPem: string): void {
    this.identities.set(key, publicKeyPem);
  }

  // ---- offers --------------------------------------------------------------

  createOffer(input: {
    binding: Binding;
    household: string;
    purpose: Purpose;
    config_version: string;
    expires_at: number;
    mandate: string;
    candidates: {
      product: string;
      quantity: number;
      predicted_conversion: number | null;
      is_exploration: boolean;
    }[];
  }): Offer {
    const config = this.configs.get(input.config_version);
    if (!config) {
      throw notFound(`no presenter config ${input.config_version}`);
    }
    if (input.candidates.length < 1) {
      throw badRequest("malformed", "an offer needs at least one candidate");
    }

    const candidates: Candidate[] = input.candidates.map((c) => {
      const entry = config.products[c.product];
      if (!entry) {
        throw notFound(`no product ${c.product} in config ${config.version}`);
      }
      if (c.is_exploration) {
        const unknownToHousehold = !this.householdHasSeen(
          input.household,
          c.product
        );
        const belowThreshold =
          c.predicted_conversion !== null &&
          c.predicted_conversion <= this.config.explorationThreshold;
        if (!unknownToHousehold && !belowThreshold) {
          // §5.1. Marking a well-predicted, already-known product as
          // exploration would let a presenter satisfy the floor with
          // candidates it fully expects to be kept, which is the floor's
          // whole subject.
          throw unprocessable(
            "not_exploration",
            `candidate ${c.product} does not qualify as exploration`
          );
        }
      }
      return {
        id: randomUUID(),
        product: c.product,
        quantity: c.quantity,
        // §3.1. Taken from the frozen catalogue, never from the request.
        unit_price: entry.price,
        predicted_conversion: c.predicted_conversion,
        is_exploration: c.is_exploration,
        valence: "offered",
        decided_at: null,
        kept_as: null,
        lineage: null,
      };
    });

    // §5. The floor is checked before anything is written.
    const required = explorationFloor(
      candidates.length,
      this.config.explorationRate
    );
    const marked = candidates.filter((c) => c.is_exploration).length;
    if (marked < required) {
      throw unprocessable(
        "exploration_floor",
        `offer has ${marked} exploration candidates; ${required} are required for ${candidates.length} candidates`
      );
    }

    const offer: Offer = {
      id: randomUUID(),
      binding: input.binding,
      household: input.household,
      presenter: config.presenter,
      purpose: input.purpose,
      config_version: config.version,
      presented_at: null,
      expires_at: input.expires_at,
      state: "drafted",
      exploration_floor_met: true,
      mandate: input.mandate,
      candidates,
      reminders_sent: 0,
    };
    this.offers.set(offer.id, offer);
    for (const c of candidates) this.candidateIndex.set(c.id, offer.id);
    return offer;
  }

  async present(offerId: string, now = Date.now()): Promise<Offer> {
    const offer = this.mustGet(offerId);
    if (offer.state !== "drafted") {
      throw conflict("bad_state", `cannot present an offer in ${offer.state}`);
    }
    if (offer.expires_at <= now) {
      throw unprocessable("already_expired", "expires_at is in the past");
    }
    // §6.4. The reserve is the upper bound of what this offer can ever settle
    // at: every candidate kept, at the frozen price.
    await this.ledger.reserve({
      requestId: offer.id,
      household: offer.household,
      amount: this.upperBound(offer),
      expiresAt: offer.expires_at,
    });
    offer.state = "presented";
    offer.presented_at = now;
    return offer;
  }

  decide(
    offerId: string,
    decisions: { candidate: string; valence: Valence; kept_as?: KeptAs; lineage?: string }[],
    now = Date.now()
  ): Offer {
    const offer = this.mustGet(offerId, now);
    if (offer.state !== "presented") {
      throw conflict("bad_state", `cannot decide an offer in ${offer.state}`);
    }
    for (const d of decisions) {
      const candidate = offer.candidates.find((c) => c.id === d.candidate);
      if (!candidate) throw notFound(`no candidate ${d.candidate} in this offer`);
      if (candidate.valence !== "offered") {
        throw conflict(
          "already_decided",
          `candidate ${d.candidate} is already ${candidate.valence}`
        );
      }
      this.assertValenceAllowed(offer, d.valence);
      if (d.valence === "kept") {
        if (!d.kept_as) {
          throw badRequest("malformed", "kept requires kept_as");
        }
        if (d.kept_as === "gift") {
          if (!d.lineage) {
            throw badRequest("malformed", "kept_as gift requires a lineage edge");
          }
          if (!this.edges.has(d.lineage)) {
            throw notFound(`no lineage edge ${d.lineage}`);
          }
        }
        candidate.kept_as = d.kept_as;
        candidate.lineage = d.lineage ?? null;
      } else if (d.kept_as || d.lineage) {
        throw badRequest(
          "malformed",
          "kept_as and lineage are only present when kept"
        );
      }
      candidate.valence = d.valence;
      candidate.decided_at = now;
    }
    if (offer.candidates.every((c) => c.valence !== "offered")) {
      offer.state = "decided";
    }
    return offer;
  }

  remind(offerId: string, now = Date.now()): Offer {
    const offer = this.mustGet(offerId, now);
    if (offer.state !== "presented") {
      throw conflict("bad_state", `cannot remind an offer in ${offer.state}`);
    }
    if (offer.reminders_sent >= this.config.reminderLimit) {
      // Clause 37. Not a rate limit that a caller waits out.
      throw conflict("reminder_limit", "this offer has had its reminder");
    }
    offer.reminders_sent += 1;
    return offer;
  }

  async withdraw(offerId: string, now = Date.now()): Promise<Offer> {
    const offer = this.mustGet(offerId, now);
    if (offer.state === "settled" || offer.state === "withdrawn") {
      throw conflict("bad_state", `cannot withdraw an offer in ${offer.state}`);
    }
    for (const c of offer.candidates) {
      if (c.valence === "offered") {
        c.valence = "returned";
        c.decided_at = now;
      }
    }
    offer.state = "withdrawn";
    if (this.ledger.get(offer.id)) {
      await this.ledger.release({ requestId: offer.id, reason: "withdrawn" });
    }
    return offer;
  }

  async settle(offerId: string, now = Date.now()): Promise<Settlement> {
    const offer = this.mustGet(offerId, now);
    const existing = this.settlements.get(offer.id);
    if (existing) return existing;
    if (offer.state !== "decided" && offer.state !== "expired") {
      throw conflict("bad_state", `cannot settle an offer in ${offer.state}`);
    }

    let kept = 0;
    let consumed = 0;
    let lost = 0;
    const config = this.configs.get(offer.config_version);
    if (!config) {
      // §6.3. A settlement uses the version stamped at creation. A missing
      // version is a failure, never a fallback to the current catalogue.
      throw conflict(
        "config_missing",
        `config ${offer.config_version} is no longer available`
      );
    }
    for (const c of offer.candidates) {
      if (c.valence === "kept" || c.valence === "defaulted") {
        kept += c.unit_price * c.quantity;
      } else if (c.valence === "consumed") {
        const entry = config.products[c.product];
        if (!entry) throw conflict("config_missing", `no cost basis for ${c.product}`);
        consumed += entry.cost * c.quantity;
      } else if (c.valence === "lost") {
        lost += c.unit_price * c.quantity;
      }
    }

    const charged = kept + consumed;
    if (charged > 0) {
      await this.ledger.commit({ requestId: offer.id, amount: charged });
    } else if (this.ledger.get(offer.id)) {
      await this.ledger.release({ requestId: offer.id, reason: "nothing_kept" });
    }

    const settlement: Settlement = {
      offer: offer.id,
      settled_at: now,
      kept_amount: kept,
      consumed_amount: consumed,
      // §3.2. Reported so the stock holder can see it. Not in `charged`.
      lost_amount: lost,
      receipt: createHash("sha256")
        .update(`${offer.id}:${now}:${kept}:${consumed}:${offer.presenter}`)
        .digest("hex"),
    };
    this.settlements.set(offer.id, settlement);
    offer.state = "settled";
    return settlement;
  }

  // ---- expiry --------------------------------------------------------------

  /**
   * §2.2. The only place the two bindings diverge, and here they do not: an
   * undecided candidate becomes `returned` under both. What differs is the
   * reason, and for `ceremonial` one candidate is shipped instead.
   *
   * There is no parameter that makes an undecided digital candidate `kept`.
   */
  private applyExpiry(offer: Offer, now: number): void {
    if (offer.state !== "presented") return;
    if (offer.expires_at > now) return;
    const undecided = offer.candidates.filter((c) => c.valence === "offered");
    if (offer.purpose === "ceremonial" && undecided.length > 0) {
      const first = undecided[0]!;
      first.valence = "defaulted";
      first.decided_at = now;
    }
    for (const c of offer.candidates) {
      if (c.valence === "offered") {
        c.valence = "returned";
        c.decided_at = now;
      }
    }
    offer.state = "expired";
  }

  sweep(now = Date.now()): Offer[] {
    const touched: Offer[] = [];
    for (const offer of this.offers.values()) {
      const before = offer.state;
      this.applyExpiry(offer, now);
      if (offer.state !== before) touched.push(offer);
    }
    return touched;
  }

  // ---- notes ---------------------------------------------------------------

  addNote(input: {
    candidate: string;
    author: string;
    text: string;
    visibility: "self" | "self_and_recipient";
    now?: number;
  }): Note {
    const offerId = this.candidateIndex.get(input.candidate);
    if (!offerId) throw notFound(`no candidate ${input.candidate}`);
    const note: Note = {
      candidate: input.candidate,
      author: input.author,
      text: input.text,
      visibility: input.visibility,
      created_at: input.now ?? Date.now(),
    };
    const list = this.notes.get(input.candidate) ?? [];
    list.push(note);
    this.notes.set(input.candidate, list);
    return note;
  }

  notesFor(candidateId: string): Note[] {
    return this.notes.get(candidateId) ?? [];
  }

  // ---- lineage -------------------------------------------------------------

  /**
   * §7.1. Recognition turns on the giver's key being attested and the receipt
   * carrying the merchant's signature. Nothing here reads the client, and no
   * request field names one, so an edge from a fork is accepted on the same
   * terms as an edge from the reference hub (clause 25).
   */
  acceptEdge(input: {
    from: string;
    to: string;
    product: string;
    merchant: string;
    kind: LineageKind;
    occasion: string;
    receipt: string;
    signature: string;
    now?: number;
  }): LineageEdge {
    const publicKey = this.identities.get(input.from);
    if (!publicKey) {
      throw unprocessable("unattested_key", `key ${input.from} is not attested`);
    }
    if (!verifyEdge(input, publicKey)) {
      throw unprocessable("bad_signature", "signature does not verify");
    }
    const edge: LineageEdge = {
      id: randomUUID(),
      from: input.from,
      to: input.to,
      product: input.product,
      merchant: input.merchant,
      kind: input.kind,
      occasion: input.occasion,
      receipt: input.receipt,
      signature: input.signature,
      created_at: input.now ?? Date.now(),
    };
    this.edges.set(edge.id, edge);
    // §7.4. The recipient's record holds the fact of receipt and nothing else.
    // No preference, no profile, no score is derived from having received.
    const received = this.receipts.get(edge.to) ?? [];
    received.push({ edge: edge.id, at: edge.created_at });
    this.receipts.set(edge.to, received);
    return edge;
  }

  /**
   * §7.2. Acts of the recipient, and nothing else.
   *
   * The giver's own outgoing edges are not returned here and no row carries a
   * reference to the gift it answers, so no field's value or absence reports
   * that a recipient did not respond. §7.5: no total, no network size, no
   * ranking is computed or returned.
   */
  actsVisibleToGiver(giver: string): LineageEdge[] {
    const acts: LineageEdge[] = [];
    for (const edge of this.edges.values()) {
      if (edge.to !== giver) continue;
      if (edge.kind === "gift") continue;
      acts.push(edge);
    }
    return acts.sort((a, b) => a.created_at - b.created_at);
  }

  receiptsFor(household: string): { edge: string; at: number }[] {
    return this.receipts.get(household) ?? [];
  }

  edge(id: string): LineageEdge | undefined {
    return this.edges.get(id);
  }

  // ---- reads ---------------------------------------------------------------

  offersForHousehold(household: string, now = Date.now()): Offer[] {
    this.sweep(now);
    return [...this.offers.values()].filter((o) => o.household === household);
  }

  settlement(offerId: string): Settlement | undefined {
    return this.settlements.get(offerId);
  }

  mustGet(offerId: string, now?: number): Offer {
    const offer = this.offers.get(offerId);
    if (!offer) throw notFound(`no offer ${offerId}`);
    if (now !== undefined) this.applyExpiry(offer, now);
    return offer;
  }

  // ---- internals -----------------------------------------------------------

  private upperBound(offer: Offer): number {
    return offer.candidates.reduce(
      (sum, c) => sum + c.unit_price * c.quantity,
      0
    );
  }

  private householdHasSeen(household: string, product: string): boolean {
    for (const offer of this.offers.values()) {
      if (offer.household !== household) continue;
      for (const c of offer.candidates) {
        if (c.product === product && c.valence === "kept") return true;
      }
    }
    for (const edge of this.edges.values()) {
      if (edge.to === household && edge.product === product) return true;
    }
    return false;
  }

  private assertValenceAllowed(offer: Offer, valence: Valence): void {
    if (valence === "offered") {
      throw badRequest("malformed", "offered is not a decision");
    }
    if (valence === "defaulted") {
      throw unprocessable(
        "not_decidable",
        "defaulted is only reached by expiry of a ceremonial offer"
      );
    }
    if (valence === "consumed" || valence === "lost") {
      if (offer.binding !== "physical") {
        throw unprocessable(
          "binding_mismatch",
          `${valence} exists only in the physical binding`
        );
      }
    }
  }
}
