import { randomUUID, createHash } from "node:crypto";
import { badRequest, conflict, notFound, unprocessable } from "../common/errors.js";
import type { Ledger } from "./ledger.js";
import { verifyEdge } from "../shared/lineage.js";
import { confirmationToken, verifyBy, verifyDecisions, verifyDecisionAssertion, type DecisionAssertion } from "../shared/decisions.js";
import { MandateRegister } from "../hub/mandates.js";
import { LocalMandates, type MandateSource } from "./mandate-source.js";
import { LocalDay, type DaySource } from "./day-source.js";
import { inMemoryStore, type Store } from "../common/store.js";
import { HouseholdLedger } from "../hub/household-ledger.js";
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
} from "../common/types.js";

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
  /**
   * §10.5, §14b. The name a member's device signs for when it confirms with a
   * passkey, which is the hub's own hostname. It has no default: an engine
   * that cannot tell whom an assertion was made for cannot check one, and
   * §10.5 requires every implementation to accept the assertion shape, so
   * there is no conforming deployment that does not need this. On a split
   * deployment the name is the hub's and the engine is told it.
   */
  relyingPartyId: string;
  /**
   * §16.3. Where the deployment puts the start of a household's day, for the
   * daily ceiling. The specification does not name one: a household's day
   * needs a time zone, and choosing it here would make when a person's day
   * starts this engine's business. The default is UTC midnight, which is a
   * declared choice rather than an absent one, and a deployment MUST apply
   * the same boundary to every household it holds.
   */
  dayStart?: (now: number) => number;
};

/** §16.3. The default day boundary: UTC midnight, declared rather than assumed. */
function utcMidnight(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * §5.4. What a presenter signs when it publishes a catalogue: the version,
 * the presenter's name, and each product with its merchant, carrier and
 * price, in key order.
 */
export function canonicalConfig(config: PresenterConfig): Buffer {
  const products = Object.keys(config.products)
    .sort()
    .map((ref) => {
      const e = config.products[ref]!;
      // §16.4. The category is signed with the price. Left out of the bytes,
      // whoever relays a catalogue could strip it, and a candidate that needed
      // a second signature would quietly stop needing one.
      return [ref, e.merchant, e.ships, String(e.price), e.category ?? ""].join(":");
    });
  return Buffer.from([config.version, config.presenter, ...products].join("\n"), "utf8");
}

export function explorationFloor(candidateCount: number, rate: number): number {
  return Math.max(1, Math.ceil(candidateCount * rate));
}

export class ValenceEngine {
  private readonly offers: Map<string, Offer>;
  private readonly notes: Map<string, Note[]>;
  private readonly settlements: Map<string, Settlement>;
  private readonly configs: Map<string, PresenterConfig>;
  private readonly edges: Map<string, LineageEdge>;
  private readonly identities: Map<string, string>;
  /**
   * §10.5. What has already confirmed each offer. A confirmation is used
   * once: the canonical form binds a decided set to an offer and to nothing
   * else, so without this the bytes that confirmed a set stay good after the
   * person takes it back, and anything that saw them once can undo the
   * withdrawal. Measured on 2026-09-11 before it was closed.
   */
  private readonly confirmations: Map<string, string[]>;
  /** §7.1. Keys an identity root endorsed, as against keys merely registered here. */
  private readonly rootEndorsed: Map<string, true>;
  /**
   * §7.6 and clause 19. The value stored beside the time is an opaque token,
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
  readonly recoveries: RecoveryLedger;
  readonly mandates: MandateRegister;
  /**
   * §13.1. Where protections are read from. A deployment presenting both roles
   * reads its own register; one presenting the engine alone is given a source
   * that asks the hub.
   */
  private mandateSource: MandateSource;
  /**
   * §16.3. The person's own copy of what settled for them. A deployment
   * presenting both roles keeps it here; one presenting the engine alone
   * reports to the hub and asks the hub for the day's total.
   */
  readonly householdLedger: HouseholdLedger;
  private daySource: DaySource;

  /** §13.1. Point the engine at a hub it does not share a process with. */
  readMandatesFrom(source: MandateSource): void {
    this.mandateSource = source;
  }

  /** §16.3. Point the day's total at the hub that holds the person's copy. */
  readTheDayFrom(source: DaySource): void {
    this.daySource = source;
  }

  readonly config: EngineConfig;

  constructor(
    private readonly ledger: Ledger,
    config: EngineConfig,
    // §13.2. Where this engine keeps what it holds. Unset is in memory, which
    // is what the conformance suites run against.
    store: Store = inMemoryStore()
  ) {
    this.offers = store.map("offers");
    this.notes = store.map("notes");
    this.settlements = store.map("settlements");
    this.configs = store.map("configs");
    this.edges = store.map("edges");
    this.identities = store.map("identities");
    this.confirmations = store.map("confirmations");
    this.rootEndorsed = store.map("root_endorsed");
    this.recoveries = new RecoveryLedger(store);
    this.mandates = new MandateRegister(store);
    this.householdLedger = new HouseholdLedger(store);
    this.mandateSource = new LocalMandates(this.mandates);
    this.daySource = new LocalDay(this.householdLedger);
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
    if (typeof config.relyingPartyId !== "string" || config.relyingPartyId.trim() === "") {
      throw new Error(
        "relyingPartyId must be the name a member's device signs for (SPEC §14b). " +
          "There is no default: an engine that cannot place an assertion cannot check one."
      );
    }
    if (!Number.isInteger(config.recoveryGraceDays) || config.recoveryGraceDays < 0) {
      throw new Error("recoveryGraceDays must be an integer of at least zero");
    }
    this.config = { ...config };
    Object.freeze(this.config);
  }

  // ---- presenter catalogue -------------------------------------------------

  /**
   * §5.4. A catalogue is published by the presenter it names, or not at all.
   * The presenter's key signs a canonical form of the version, its name and
   * its products, so nobody else registers catalogues under a presenter's
   * name and a presenter cannot disown one it registered.
   */
  registerConfig(config: PresenterConfig, signature?: string): PresenterConfig {
    if (this.configs.has(config.version)) {
      throw conflict("config_exists", `config ${config.version} already exists`);
    }
    const pem = this.identities.get(config.presenter);
    if (!pem) {
      throw unprocessable(
        "unknown_presenter",
        `no key is registered for presenter ${config.presenter}`
      );
    }
    let ok = false;
    try {
      ok =
        signature !== undefined &&
        verifyBy(pem, canonicalConfig(config), Buffer.from(signature, "base64"));
    } catch {
      ok = false;
    }
    if (!ok) {
      throw unprocessable(
        "bad_signature",
        `this catalogue is not signed by ${config.presenter}`
      );
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
    if (attested) this.rootEndorsed.set(key, true);
  }

  /** §7.1. Whether an identity root endorsed this key (clause 2). */
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
        // §16.4. The category travels with the price and the merchant, from
        // the catalogue and never from the request.
        category: entry.category ?? null,
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
      // §5.4. Whether an identity root endorsed this presenter's key, or the
      // key is merely registered here. A rename is a second identity, and a
      // household is entitled to see which kind it is dealing with.
      presenter_attested: this.rootEndorsed.has(config.presenter),
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
      decided_at: null,
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
    const mandate = await this.mandateSource.get(offer.mandate);
    if (mandate) {
      if (mandate.lapses_at <= now) {
        throw unprocessable("mandate_lapsed", `mandate ${offer.mandate} lapsed and was not renewed`);
      }
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
    return this.commit(offer);
  }

  async decide(
    offerId: string,
    decisions: { candidate: string; valence: Valence; kept_as?: KeptAs; lineage?: string }[],
    signature: string | DecisionAssertion,
    coSignature?: string,
    now = Date.now()
  ): Promise<Offer> {
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
    // §10.5. Two shapes, and the canonical form is what is signed in both:
    // once directly, and once as the challenge inside an authenticator's own
    // client data. A passkey cannot sign bytes a caller hands it.
    const covered =
      typeof signature === "string"
        ? verifyDecisions(offerId, decisions, signature, mandateKey)
        : verifyDecisionAssertion(offerId, decisions, signature, mandateKey, this.config.relyingPartyId);
    if (!covered) {
      throw unprocessable("bad_signature", "the signature does not cover this decided set");
    }
    // §10.5. A confirmation is used once. The cost is named in the
    // specification rather than hidden: an ed25519 signature over the same
    // set is the same bytes, so a person who withdraws and confirms the
    // identical set again with a bare signature is refused and signs a
    // changed set or signs again with a device whose signature differs.
    const used = this.confirmations.get(offerId) ?? [];
    const confirmation = confirmationToken(
      mandateKey,
      typeof signature === "string" ? signature : signature.signature
    );
    if (used.includes(confirmation)) {
      throw unprocessable(
        "confirmation_reused",
        "this confirmation has already been used for this offer"
      );
    }
    // What this decision spends. Written only if every check below passes,
    // because §10.5 says nothing is written on refusal.
    const spent = [confirmation];
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
    // §16.4. A category the person named needs a second signature over the
    // same bytes. The check runs after the plan is built and before anything
    // is written, so a set that is refused leaves the offer as it was.
    const mandateForSet = await this.mandateSource.get(offer.mandate);
    if (mandateForSet && mandateForSet.co_sign_categories.length > 0) {
      const needs = plan.filter(
        ({ candidate }) =>
          candidate.category !== null &&
          mandateForSet.co_sign_categories.includes(candidate.category)
      );
      if (needs.length > 0) {
        const signed =
          coSignature !== undefined &&
          mandateForSet.co_signers.some((key) => {
            const pem = this.identities.get(key);
            if (!pem || !verifyDecisions(offerId, decisions, coSignature, pem)) return false;
            // §10.5. A co-signature is used once, like the confirmation it
            // sits beside. Otherwise a person who withdrew could decide the
            // same set again with a fresh signature of their own and the
            // co-signer's old bytes, and the co-signer would have consented
            // to a decision nobody asked them about.
            const token = confirmationToken(pem, coSignature);
            if (used.includes(token)) {
              throw unprocessable(
                "confirmation_reused",
                "this co-signature has already been used for this offer"
              );
            }
            spent.push(token);
            return true;
          });
        if (!signed) {
          throw unprocessable(
            "mandate_co_sign_required",
            `${needs[0]!.candidate.category} needs a co-signer's signature on this set`
          );
        }
      }
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
      // §16.5. The cooling window starts when the set is signed, not when the
      // offer was presented.
      offer.decided_at = now;
      // Clause 8. The person's own copy of what they were shown and what they
      // said to each of it. Reported here rather than at settlement, because a
      // copy that arrived only when something was bought would hold the
      // purchases and lose the refusals, which are the half no merchant holds
      // across merchants.
      await this.daySource.reportOffer({
        id: offer.id,
        household: offer.household,
        presenter: offer.presenter,
        recorded_at: now,
        offer: structuredClone(offer),
      });
    }
    this.confirmations.set(offerId, [...used, ...spent]);
    return this.commit(offer);
  }

  /**
   * §16.5. The person takes back a signed set inside its cooling window. It is
   * theirs alone and needs no co-signer: withdrawing removes a commitment, and
   * every rule about second signatures is about adding one.
   */
  async withdrawDecisions(offerId: string, now = Date.now()): Promise<Offer> {
    const offer = this.mustGet(offerId, now);
    if (offer.state !== "decided") {
      throw conflict("bad_state", `cannot withdraw decisions on an offer in ${offer.state}`);
    }
    if (this.settlements.get(offer.id)) {
      throw conflict("bad_state", "this offer has settled");
    }
    const mandate = await this.mandateSource.get(offer.mandate);
    const cooling = mandate?.cooling_seconds ?? null;
    if (cooling === null) {
      throw unprocessable(
        "no_cooling",
        "this mandate has no cooling window, so a signed set is final"
      );
    }
    if (offer.decided_at !== null && now >= offer.decided_at + cooling * 1000) {
      throw unprocessable(
        "cooling_over",
        "the cooling window has closed and the set is final"
      );
    }
    for (const c of offer.candidates) {
      c.valence = "offered";
      c.kept_as = null;
      c.lineage = null;
      c.decided_at = null;
    }
    offer.state = "presented";
    offer.decided_at = null;
    return this.commit(offer);
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
    return this.commit(offer);
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
    return this.commit(offer);
  }

  async settle(offerId: string, now = Date.now()): Promise<Settlement> {
    const offer = this.mustGet(offerId, now);
    const existing = this.settlements.get(offer.id);
    if (existing) return existing;
    if (offer.state !== "decided" && offer.state !== "expired") {
      throw conflict("bad_state", `cannot settle an offer in ${offer.state}`);
    }
    // §16.5 and §16.3. Both refusals name themselves: four refusals in this
    // section share a status code, and a `422` that says only "unprocessable"
    // is one a person cannot act on and a probe cannot tell from another.
    const mandate = await this.mandateSource.get(offer.mandate);
    if (mandate?.cooling_seconds != null && offer.decided_at !== null) {
      const opens = offer.decided_at + mandate.cooling_seconds * 1000;
      if (now < opens) {
        throw unprocessable(
          "mandate_cooling",
          `this set settles at ${opens}, after the cooling window the person set`
        );
      }
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

    // §16.3. The daily ceiling is the household's own union across every
    // presenter, so it is summed here and read by nobody else: a presenter
    // learns that this settlement was refused, which is what it learns when a
    // household declines (clause 38).
    if (mandate?.ceiling_daily != null) {
      const dayStart = (this.config.dayStart ?? utcMidnight)(now);
      // §16.3. The sum comes from the person's own copy, not from this
      // engine's settlements: an engine summing its own is a merchant
      // computing a household's union (clause 38), and two engines would give
      // one household two ceilings.
      const already = await this.daySource.totalSince(offer.household, dayStart);
      if (already + charged > mandate.ceiling_daily) {
        throw unprocessable(
          "mandate_ceiling_daily",
          `${already + charged} would settle for this household today, above the daily ceiling of ${mandate.ceiling_daily}`
        );
      }
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
    // §16.3. The person's own copy, written as the settlement is made. It
    // carries an amount and a date and nothing about what was in the offer: a
    // copy that carried products would be a second vertical ledger on the
    // person's side rather than the person's own.
    await this.daySource.report({
      offer: offer.id,
      household: offer.household,
      amount: charged,
      settled_at: now,
    });
    offer.state = "settled";
    this.commit(offer);
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
  private applyExpiry(offer: Offer, now: number): boolean {
    if (offer.state !== "presented") return false;
    if (offer.expires_at > now) return false;
    if (offer.binding === "physical") {
      // §11. What the route found decides first, and the deadline decides the
      // rest. Silence does not become `returned` here as it does in the
      // digital binding: the goods are in someone's home, and nobody has
      // looked at them yet.
      applyRecovery(offer, this.recoveries.for(offer.id), now);
      if (offer.candidates.every((c) => c.valence !== "offered")) {
        offer.state = "expired";
      }
      return true;
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
    // Past both guards, so the deadline has passed on an offer that was still
    // presented and something above has changed. The caller writes it back.
    return true;
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
    return this.commit(offer);
  }

  sweep(now = Date.now()): Offer[] {
    const touched: Offer[] = [];
    for (const offer of this.offers.values()) {
      const before = offer.state;
      if (this.applyExpiry(offer, now)) this.commit(offer);
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
    // §7.6. The recipient's record holds the fact of receipt and nothing else.
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
   * that a recipient did not respond. §7.7: no total, no network size, no
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

  /**
   * §10.5, §14.1. What has already confirmed each of these offers, so that a
   * move carries the one-use rule with it. The values are opaque: they name
   * signatures rather than being them, and a receiving host compares them
   * without reading them.
   */
  confirmationsFor(offerIds: string[]): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const id of offerIds) {
      const spent = this.confirmations.get(id);
      if (spent && spent.length > 0) out[id] = [...spent];
    }
    return out;
  }

  /** The receiving host of a move keeps what the sending host had spent. */
  importConfirmations(rows: Record<string, string[]>): void {
    for (const [id, spent] of Object.entries(rows)) {
      if (!Array.isArray(spent)) continue;
      const here = this.confirmations.get(id) ?? [];
      const merged = [...here];
      for (const token of spent) {
        if (typeof token === "string" && !merged.includes(token)) merged.push(token);
      }
      this.confirmations.set(id, merged);
    }
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
    // The physical binding can change a candidate's valence at the deadline
    // and leave the offer presented, so what decides the write is whether
    // anything changed and not whether the state did.
    if (now !== undefined && this.applyExpiry(offer, now)) this.commit(offer);
    return offer;
  }

  /**
   * Put the offer back in the map, because changing it in place does not.
   *
   * A store's map writes through on `set` and can see nothing else: assigning
   * a field of a value it handed out reaches memory and never the disk. Found
   * on 2026-09-11 by restarting a server against the same file. An offer that
   * read `presented` before the restart read `drafted` after it, because
   * presentation assigns `offer.state` and stopped there, and the persistence
   * built the same day was proven by a test that wrote a key rather than by
   * one that moved an offer through its states.
   *
   * Every method here that changes an offer or one of its candidates ends by
   * calling this. `store_does_not_write_through` breaks the write itself and
   * `state_change_is_not_committed` breaks these calls; both are caught by
   * `test/store.test.ts`, which is the only place a restart can happen.
   */
  private commit(offer: Offer): Offer {
    this.offers.set(offer.id, offer);
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
