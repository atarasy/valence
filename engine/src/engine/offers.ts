import { randomUUID, createHash } from "node:crypto";
import { badRequest, conflict, notFound, unprocessable } from "./errors.js";
import type { Ledger } from "./ledger.js";
import { verifyEdge } from "./lineage.js";
import { verifyDecisions } from "./mandate.js";
import { MandateRegister } from "./mandates.js";
import {
  applyRecovery,
  ineligibleReason,
  RecoveryLedger,
} from "./physical.js";
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
  SettlementLine,
  PriceBand,
  NoteParty,
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
  /** §10.4. At most one reminder. Kept configurable downward, never upward. */
  reminderLimit: 0 | 1;
  /**
   * §11. Days after the recovery deadline before an uncollected candidate is
   * `lost`. A deployment parameter with no recommended figure, like the
   * exploration rate, so it is required rather than defaulted.
   */
  recoveryGraceDays: number;
  /**
   * Clause 46. Whether a merchant is one the registry lists, which is what
   * "in the network" means. A deployment without a registry treats every
   * merchant as in it, and the ceiling then binds nothing, which is the
   * honest default rather than a silent one.
   */
  isInNetwork?: (merchant: string) => boolean;
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
  /** §7.1. Keys an identity root endorsed, as against keys merely registered here. */
  private readonly rootEndorsed = new Set<string>();
  /**
   * §7.5 and clause 19. The value stored beside the time is an opaque token,
   * not the edge's identifier.
   *
   * Returning the edge id looked like the fact of receipt and was a purchase
   * history one hop long: an edge carries a product and a merchant, so the
   * moment any route resolves the identifier the record stops being the bare
   * fact. Nothing resolves this token, and no route accepts it.
   */
  private readonly receipts = new Map<string, { ref: string; at: number }[]>();
  private readonly candidateIndex = new Map<string, string>();

  /**
   * §11. The physical binding's operations. Empty for a digital-only
   * deployment, which is why it is a member rather than a constructor
   * argument: an implementation that never places goods never touches it.
   */
  readonly recoveries = new RecoveryLedger();
  readonly mandates = new MandateRegister();

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
    if (!Number.isInteger(config.recoveryGraceDays) || config.recoveryGraceDays < 0) {
      throw new Error("recoveryGraceDays must be an integer of at least zero");
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

  registerIdentity(key: string, publicKeyPem: string, attested = false): void {
    // A key, once attested, is not replaced by a later caller: whoever could
    // overwrite it could sign as the person (clauses 22, 35).
    const existing = this.identities.get(key);
    if (existing !== undefined && existing !== publicKeyPem) {
      throw conflict("identity_exists", `a key is already registered for ${key}`);
    }
    this.identities.set(key, publicKeyPem);
    if (attested) this.rootEndorsed.add(key);
  }

  /** §7.1. Whether an identity root endorsed this key (clause 2, `02` §3.2). */
  isRootEndorsed(key: string): boolean {
    return this.rootEndorsed.has(key);
  }

  // ---- offers --------------------------------------------------------------

  createOffer(input: {
    binding: Binding;
    household: string;
    purpose: Purpose;
    config_version: string;
    expires_at: number;
    mandate: string;
    price_band: PriceBand | null;
    giver: string | null;
    candidates: {
      product: string;
      quantity: number;
      predicted_conversion: number | null;
      is_exploration: boolean;
      given_by: string | null;
    }[];
  }): Offer {
    const config = this.configs.get(input.config_version);
    if (!config) {
      throw notFound(`no presenter config ${input.config_version}`);
    }
    if (input.candidates.length < 1) {
      throw badRequest("malformed", "an offer needs at least one candidate");
    }
    // One line per product. A product listed twice is one novelty counted
    // twice toward the floor, and a quantity is what a line carries.
    const products = new Set<string>();
    for (const c of input.candidates) {
      if (products.has(c.product)) {
        throw badRequest("malformed", `product ${c.product} appears twice; use quantity`);
      }
      products.add(c.product);
    }

    const candidates: Candidate[] = input.candidates.map((c) => {
      const entry = config.products[c.product];
      if (!entry) {
        throw notFound(`no product ${c.product} in config ${config.version}`);
      }
      if (input.binding === "physical") {
        // §11.1. Refused at creation rather than at placement: a lorry is a
        // bad place to discover that a product cannot go in a home.
        const periodDays = Math.max(
          1,
          Math.ceil((input.expires_at - Date.now()) / 86_400_000)
        );
        const reason = ineligibleReason(entry.physical, periodDays);
        if (reason) {
          throw unprocessable(
            "not_eligible_for_placement",
            `${c.product} cannot be placed in a home: ${reason}`
          );
        }
      }
      if (c.is_exploration) {
        // §5.1. Exploration is what this household has never been offered by
        // this presenter. A low prediction on a known product is a known
        // dislike, not exploration, and marking a known product would let a
        // presenter satisfy the floor with what it already expects.
        if (this.householdHasSeen(input.household, config.presenter, c.product)) {
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
        merchant: entry.merchant,
        ships: entry.ships,
        predicted_conversion: c.predicted_conversion,
        is_exploration: c.is_exploration,
        given_by: c.given_by,
        valence: "offered",
        decided_at: null,
        kept_as: null,
        lineage: null,
      };
    });

    // §5. The floor is checked before anything is written.
    // §5. The floor is the rate's, and it does not bend to what the presenter
    // has left. A presenter that has shown this household everything it has
    // owes it an offer only once its range grows: selling out is not a state
    // a conforming implementation reaches, and a cap that let the floor fall
    // to zero made that sentence false for any small catalogue.
    // Novelty is counted over every catalogue this presenter has registered,
    // not the one this offer names, so a narrower version cannot shrink it.
    const everyProduct = new Set<string>();
    for (const cfg of this.configs.values()) {
      if (cfg.presenter === config.presenter) {
        for (const ref of Object.keys(cfg.products)) everyProduct.add(ref);
      }
    }
    const novelLeft = [...everyProduct].filter(
      (ref) => !this.householdHasSeen(input.household, config.presenter, ref)
    ).length;
    const required = explorationFloor(
      candidates.length,
      this.config.explorationRate
    );
    if (novelLeft === 0) {
      throw unprocessable(
        "nothing_new",
        "this presenter has offered this household everything it has; the floor cannot be met until its range grows"
      );
    }
    const marked = candidates.filter((c) => c.is_exploration).length;
    if (marked < required) {
      throw unprocessable(
        "exploration_floor",
        `offer has ${marked} exploration candidates; ${required} are required for ${candidates.length} candidates`
      );
    }

    // Clause 23. A ceremonial offer carries the band the giver chose, and no
    // candidate in it lies outside that band. A band on any other purpose is
    // a field with no meaning, and is refused as such.
    if (input.purpose === "ceremonial") {
      if (!input.price_band) {
        throw badRequest("malformed", "a ceremonial offer carries a price_band");
      }
      if (!input.giver) {
        throw badRequest("malformed", "a ceremonial offer names its giver, who pays");
      }
      for (const c of candidates) {
        // The band bounds what a recipient's choice costs the giver: the line,
        // not the unit. Five units inside the band is five times the band.
        const line = c.unit_price * c.quantity;
        if (line < input.price_band.min || line > input.price_band.max) {
          throw unprocessable(
            "outside_band",
            `candidate ${c.product} at ${line} lies outside the band ${input.price_band.min} to ${input.price_band.max}`
          );
        }
      }
    } else if (input.price_band || input.giver) {
      throw badRequest("malformed", "price_band and giver belong to a ceremonial offer only");
    }

    const offer: Offer = {
      id: randomUUID(),
      binding: input.binding,
      household: input.household,
      presenter: config.presenter,
      purpose: input.purpose,
      price_band: input.price_band,
      giver: input.giver,
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
    // Clauses 46 and 58. The mandate is checked at presentation: it has not
    // lapsed, and what this offer could cost at merchants the registry does
    // not list is inside the ceiling the person signed. A mandate with no
    // record is left alone, because a deployment may carry mandates outside
    // this engine, and refusing every offer would be a gate rather than a
    // protection.
    const mandate = this.mandates.get(offer.mandate);
    if (mandate) {
      this.mandates.mustGet(offer.mandate, now);
      const outside = offer.candidates
        .filter((c) => !(this.config.isInNetwork ?? (() => true))(c.merchant))
        .reduce((sum, c) => sum + c.unit_price * c.quantity, 0);
      if (outside > mandate.ceiling_out_of_network) {
        throw unprocessable(
          "over_ceiling",
          `this offer could cost ${outside} at merchants outside the network, above the ceiling of ${mandate.ceiling_out_of_network}`
        );
      }
    }

    await this.ledger.reserve({
      requestId: offer.id,
      // Clause 25. A ceremonial offer is the giver's to pay; the recipient of
      // a return gift is never the party charged.
      household: offer.giver ?? offer.household,
      amount: this.upperBound(offer),
      expiresAt: offer.expires_at,
    });
    offer.state = "presented";
    offer.presented_at = now;
    if (offer.binding === "physical") {
      this.recoveries.open({
        offer: offer.id,
        dueAt: offer.expires_at,
        graceDays: this.config.recoveryGraceDays,
      });
    }
    return offer;
  }

  decide(
    offerId: string,
    decisions: { candidate: string; valence: Valence; kept_as?: KeptAs; lineage?: string }[],
    signature: string,
    now = Date.now()
  ): Offer {
    const offer = this.mustGet(offerId, now);
    if (offer.state !== "presented") {
      throw conflict("bad_state", `cannot decide an offer in ${offer.state}`);
    }
    // Clause 35. A confirmation is the person's signature over the decided
    // set. The key is the one registered for the offer's mandate; a set with
    // no key, no signature, or a signature over some other set is refused
    // before anything is written.
    const mandateKey = this.identities.get(offer.mandate);
    if (!mandateKey) {
      throw unprocessable("unsigned", `no key is registered for mandate ${offer.mandate}`);
    }
    if (!verifyDecisions(offerId, decisions, signature, mandateKey)) {
      throw unprocessable("bad_signature", "the signature does not cover this decided set");
    }
    // §10.5: nothing is written on refusal. Every line is checked before any
    // line is applied, so a set that is refused leaves the offer as it was
    // and the written set is always the signed set.
    const plan: { candidate: Candidate; d: (typeof decisions)[number] }[] = [];
    const seen = new Set<string>();
    for (const d of decisions) {
      const candidate = offer.candidates.find((c) => c.id === d.candidate);
      if (!candidate) throw notFound(`no candidate ${d.candidate} in this offer`);
      if (seen.has(d.candidate)) {
        throw badRequest("malformed", `candidate ${d.candidate} decided twice in one set`);
      }
      seen.add(d.candidate);
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
      } else if (d.kept_as || d.lineage) {
        throw badRequest(
          "malformed",
          "kept_as and lineage are only present when kept"
        );
      }
      plan.push({ candidate, d });
    }
    for (const { candidate, d } of plan) {
      if (d.valence === "kept") {
        candidate.kept_as = d.kept_as!;
        candidate.lineage = d.lineage ?? null;
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
      // Clause 33. Not a rate limit that a caller waits out.
      throw conflict("reminder_limit", "this offer has had its reminder");
    }
    offer.reminders_sent += 1;
    return offer;
  }

  async withdraw(offerId: string, now = Date.now()): Promise<Offer> {
    const offer = this.mustGet(offerId, now);
    // §2.1: withdraw leaves from drafted or presented. A signed decision is
    // the person's, and the presenter cannot void it by withdrawing under it.
    if (offer.state !== "drafted" && offer.state !== "presented") {
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
    const lines: SettlementLine[] = [];
    const line = (c: Candidate, amount: number) =>
      lines.push({ candidate: c.id, product: c.product, merchant: c.merchant, ships: c.ships, valence: c.valence, amount });
    for (const c of offer.candidates) {
      if (c.valence === "kept" || c.valence === "defaulted") {
        kept += c.unit_price * c.quantity;
        line(c, c.unit_price * c.quantity);
      } else if (c.valence === "consumed") {
        // §6.2. A gift is never billed to the person who received it; anything
        // else used is bought at the merchant's price. No cost basis exists.
        const amount = c.given_by ? 0 : c.unit_price * c.quantity;
        consumed += amount;
        line(c, amount);
      } else if (c.valence === "lost") {
        lost += c.unit_price * c.quantity;
        line(c, c.unit_price * c.quantity);
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
      charged,
      lines,
      payer: offer.giver ?? offer.household,
      // Clause 11. The presenter is not the seller; it signs for the
      // merchants named on the lines, as their disclosed agent.
      signed_by: offer.presenter,
      signed_as: "agent",
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
    if (offer.binding === "physical") {
      // §11. What the route found decides first, and the deadline decides the
      // rest. Silence does not become `returned` here as it does in the
      // digital binding: the goods are in someone's home, and nobody has
      // looked at them yet.
      applyRecovery(offer, this.recoveries.for(offer.id), now);
      if (offer.candidates.every((c) => c.valence !== "offered")) {
        offer.state = "expired";
      }
      return;
    }
    const undecided = offer.candidates.filter((c) => c.valence === "offered");
    // Clause 25: a default ships if nothing was chosen. A recipient who kept
    // one item and left the rest has chosen; nothing else ships.
    const nothingKept = offer.candidates.every((c) => c.valence !== "kept");
    if (offer.purpose === "ceremonial" && undecided.length > 0 && nothingKept) {
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

  /**
   * Folds a recorded collection into the offer's valences.
   *
   * Called when the route reports, rather than only at expiry, because a
   * collection that happened before the deadline should settle on the day it
   * happened and not on the day the deadline passes.
   */
  applyRecoveryTo(offerId: string, now = Date.now()): Offer {
    const offer = this.mustGet(offerId);
    applyRecovery(offer, this.recoveries.for(offerId), now);
    if (
      offer.state === "presented" &&
      offer.candidates.every((c) => c.valence !== "offered")
    ) {
      offer.state = "decided";
    }
    return offer;
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
    shared_with: NoteParty[];
    now?: number;
  }): Note {
    const offerId = this.candidateIndex.get(input.candidate);
    if (!offerId) throw notFound(`no candidate ${input.candidate}`);
    const note: Note = {
      candidate: input.candidate,
      author: input.author,
      text: input.text,
      shared_with: input.shared_with,
      created_at: input.now ?? Date.now(),
    };
    const list = this.notes.get(input.candidate) ?? [];
    // Clause 27: one line, written by oneself. A second line from the same
    // author is refused rather than appended; a count is an aggregate.
    if (list.some((n) => n.author === input.author)) {
      throw conflict("note_exists", "one line per author on a candidate");
    }
    list.push(note);
    this.notes.set(input.candidate, list);
    return note;
  }

  notesFor(candidateId: string): Note[] {
    return this.notes.get(candidateId) ?? [];
  }

  /**
   * Clause 27. The notes a party other than the writer may read: only those
   * the writer chose to share with that party. A line is one line; there is
   * no count, no score and no aggregate here or anywhere.
   */
  notesSharedWith(candidateId: string, party: NoteParty): Note[] {
    return this.notesFor(candidateId).filter((n) => n.shared_with.includes(party));
  }

  // ---- lineage -------------------------------------------------------------

  /**
   * §7.1. Recognition turns on the giver's key being attested and the receipt
   * carrying the merchant's signature. Nothing here reads the client, and no
   * request field names one, so an edge from a fork is accepted on the same
   * terms as an edge from the reference hub (clause 22).
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
      attested: this.rootEndorsed.has(input.from),
      created_at: input.now ?? Date.now(),
    };
    this.edges.set(edge.id, edge);
    // §7.5. The recipient's record holds the fact of receipt and nothing else.
    // No preference, no profile, no score is derived from having received.
    const received = this.receipts.get(edge.to) ?? [];
    received.push({ ref: randomUUID(), at: edge.created_at });
    this.receipts.set(edge.to, received);
    return edge;
  }

  /**
   * §7.2. Acts of the recipient, and nothing else.
   *
   * The giver's own outgoing edges are not returned here and no row carries a
   * reference to the gift it answers, so no field's value or absence reports
   * that a recipient did not respond. §7.6: no total, no network size, no
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

  /**
   * §4.2. One bit: has this household been given this product. Nothing here
   * enumerates, and the caller reaches it only through the route, which
   * requires a grant and leaves a row in the household's own record.
   */
  hasBeenGiven(household: string, product: string): boolean {
    for (const edge of this.edges.values()) {
      // §7.1. Only an attested edge makes a product known to a household.
      if (edge.attested && edge.to === household && edge.product === product) return true;
    }
    return false;
  }

  receiptsFor(household: string): { ref: string; at: number }[] {
    return this.receipts.get(household) ?? [];
  }

  /**
   * §5 of 04b. The viewer's circle: edges among the people they already know.
   *
   * Two rules shape it. It does not expand past direct edges, because a walk
   * two hops out has begun measuring network size (clause 21). And the
   * viewer's own outgoing edges carry no date and no product, because those
   * are what frame a window in which a response was due; without them the most
   * that can be read is that someone is in the circle and has never acted.
   */
  circleFor(viewer: string): {
    from: string;
    to: string;
    merchant: string;
    kind: LineageKind;
    at: number | null;
    product: string | null;
    attested: boolean;
  }[] {
    const rows = [];
    for (const edge of this.edges.values()) {
      const mine = edge.from === viewer;
      if (!mine && edge.to !== viewer) continue;
      rows.push({
        from: edge.from,
        to: edge.to,
        merchant: edge.merchant,
        kind: edge.kind,
        at: mine ? null : edge.created_at,
        product: mine ? null : edge.product,
        // §7.1, clause 2. Shown rather than filtered: a viewer sees which of
        // their edges rest on a root and which are somebody's word.
        attested: edge.attested,
      });
    }
    return rows;
  }

  /** The registered public key for a name, if there is one. */
  publicKeyFor(key: string): string | undefined {
    return this.identities.get(key);
  }

  /** Whether the identity root has attested this key. Used by a mutation. */
  isKnownKey(key: string): boolean {
    return this.identities.has(key);
  }

  edge(id: string): LineageEdge | undefined {
    return this.edges.get(id);
  }

  /**
   * Every edge this household is an endpoint of, in both directions.
   *
   * Not a surface. §7.2 keeps the outgoing edges off the giver's screen, and
   * clause 43 keeps them in the household's own record: what a surface
   * withholds, an export still carries, or a member changing hosts loses what
   * they gave.
   */
  edgesTouching(household: string): LineageEdge[] {
    return [...this.edges.values()].filter(
      (e) => e.from === household || e.to === household
    );
  }

  /** Restores an exported node into an empty engine. Clause 52. */
  importOffer(offer: Offer, household: string): void {
    if (offer.household !== household) {
      throw unprocessable("wrong_household", `offer ${offer.id} belongs to ${offer.household}`);
    }
    const existing = this.offers.get(offer.id);
    if (existing && existing.state === "settled") {
      throw conflict("bad_state", `offer ${offer.id} is settled here and does not move`);
    }
    this.offers.set(offer.id, offer);
    for (const c of offer.candidates) this.candidateIndex.set(c.id, offer.id);
  }

  importSettlement(settlement: Settlement): void {
    this.settlements.set(settlement.offer, settlement);
  }

  importNote(note: Note): void {
    const list = this.notes.get(note.candidate) ?? [];
    list.push(note);
    this.notes.set(note.candidate, list);
  }

  importEdge(edge: LineageEdge, household: string): void {
    // Clause 22 holds on a move as it does on arrival: an edge is recognised
    // by the giver's attested key, and an edge that touches neither end of
    // the moving household is not this node's to carry.
    if (edge.from !== household && edge.to !== household) {
      throw unprocessable("wrong_household", `edge ${edge.id} does not touch ${household}`);
    }
    const publicKey = this.identities.get(edge.from);
    if (!publicKey || !verifyEdge(edge, publicKey)) {
      throw unprocessable("bad_signature", `edge ${edge.id} does not verify`);
    }
    this.edges.set(edge.id, edge);
  }

  importReceipts(household: string, rows: { ref: string; at: number }[]): void {
    this.receipts.set(household, [...rows]);
  }

  // ---- reads ---------------------------------------------------------------

  /**
   * A presenter's vertical view of a household: its own offers and nothing
   * declined to anyone else (clause 8). The union across presenters exists
   * only in the household's own export.
   */
  offersForHousehold(household: string, presenter: string, now = Date.now()): Offer[] {
    this.sweep(now);
    return [...this.offers.values()].filter(
      (o) => o.household === household && o.presenter === presenter
    );
  }

  /**
   * The household's union across presenters. This is the person's own record
   * and it is read by nothing but the household's export (clause 8): no route
   * serves it to a presenter.
   */
  unionForHousehold(household: string, now = Date.now()): Offer[] {
    this.sweep(now);
    return [...this.offers.values()].filter((o) => o.household === household);
  }

  /** Clauses 5 and 43. Every catalogue version this presenter registered. */
  configsForPresenter(presenter: string): PresenterConfig[] {
    return [...this.configs.values()].filter((c) => c.presenter === presenter);
  }

  /** Clauses 5 and 43. Every offer this presenter made, whatever its state. */
  offersForPresenter(presenter: string, now = Date.now()): Offer[] {
    this.sweep(now);
    return [...this.offers.values()].filter((o) => o.presenter === presenter);
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

  /**
   * Whether this presenter has offered the product to this household, or the
   * household was given it. Any prior presentation counts, whatever the
   * verdict: a product declined before is not exploration either.
   */
  private householdHasSeen(household: string, presenter: string, product: string): boolean {
    for (const offer of this.offers.values()) {
      if (offer.household !== household || offer.presenter !== presenter) continue;
      if (offer.presented_at === null) continue;
      for (const c of offer.candidates) {
        if (c.product === product) return true;
      }
    }
    for (const edge of this.edges.values()) {
      // §7.1, clause 2. Only an attested edge makes a product known here.
      // An unattested edge is anybody's claim, and counting it would let a
      // stranger empty this household's exploration floor by writing edges.
      if (edge.attested && edge.to === household && edge.product === product) return true;
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
      // §11. What was used is what the collection found; what was never
      // collected is what the deadline decides. Neither is a verdict a
      // household gives itself, since either would let it pay cost, or
      // nothing, for what it kept.
      throw unprocessable(
        "not_decidable",
        `${valence} is recorded by the collection or the deadline, not decided`
      );
    }
  }
}
