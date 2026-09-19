import { inMemoryStore, type Store } from "../common/store.js";
import { verifyPersonal, type Assertion } from "../shared/decisions.js";
import { badRequest, conflict, notFound, unprocessable } from "../common/errors.js";
import { householdOfMandate, isHouseholdName } from "../common/names.js";

/**
 * Clauses 46 and 47. A person's standing protections, in a record only that
 * person can loosen, and only with whoever they named beside them.
 *
 * Until 2026-09-09 a mandate was a string an offer carried, so both clauses
 * were promises: nothing held a ceiling, and nothing could tell a loosening
 * from a tightening. What made them checkable was writing down which changes
 * need whose signature.
 */
export type Mandate = {
  id: string;
  household: string;
  /**
   * Clause 46. What may be paid, in one offer, to merchants the registry does
   * not list. The registry is what "in the network" means, and this is the
   * person's own limit on the rest, applied inside their own mandate.
   */
  ceiling_out_of_network: number;
  /** Clause 47. Named while the person has capacity; a loosening needs them all. */
  co_signers: string[];
  /** Clause 58. A standing mandate lapses unless renewed. */
  /** §16.3. What may settle for this household in one day. Null is no ceiling, which 0 is not. */
  ceiling_daily: number | null;
  /** §16.5. How long a decided set waits before it settles. Null is no cooling. */
  cooling_seconds: number | null;
  lapses_at: number;
  version: number;
};

/**
 * What is signed. A version is inside the bytes, so an old signature cannot
 * be replayed onto a new record.
 */
/**
 * §16.1, question 58, decided 2026-09-19. The first line names the form and
 * the second the host the version is recorded at, which is the relying party
 * a passkey there asserts for. A raw signature carried nothing that tied it
 * to a host, so every version a household ever signed recorded at any host
 * that held none of its history, through three routes a version rule could
 * not close (a claim planted with an old version's terms, a restart at 1, and
 * the reference hub writing 1 after every move). Measured by a fourth
 * refutation pass over question 56.
 */
export const MANDATE_DOMAIN = "valence.mandate.2";

export function canonicalMandate(m: Omit<Mandate, "version"> & { version: number }, host: string): Buffer {
  return Buffer.from(
    [
      MANDATE_DOMAIN,
      host,
      m.id,
      m.household,
      String(m.ceiling_out_of_network),
      // §16. The three added on 2026-09-10 sit here and not at the end, so the
      // record's order is its own rather than an accident of history. Nothing
      // stored breaks: a signature is checked when its version is submitted
      // and is never retained.
      // Absent is an empty line and not a zero: a daily ceiling of 0 refuses
      // everything and no daily ceiling refuses nothing, and the signed bytes
      // have to tell them apart. `== null` rather than `=== null` because an
      // older host's export can omit the field entirely.
      m.ceiling_daily == null ? "" : String(m.ceiling_daily),
      m.cooling_seconds == null ? "" : String(m.cooling_seconds),
      // **Each item is escaped before the join.** A plain comma join is
      // malleable: `["a","b"]` and `["a,b"]` are the same bytes, so whoever
      // relays a change can fuse two co-signers into a name nobody holds and
      // the signature still verifies. Measured 2026-09-11 by an adversarial
      // pass, on the category list that left with §16.4 the following day.
      // §7.1's edge form already escapes for this reason.
      [...m.co_signers].sort().map(encodeURIComponent).join(","),
      String(m.lapses_at),
      String(m.version),
    ].join("\n"),
    "utf8"
  );
}

/**
 * A change loosens when it raises the ceiling, drops a co-signer, or pushes
 * the lapse further out. Tightening is the person's alone; loosening needs
 * every co-signer the record named before the change, which is what clause 47
 * means by "signed by both the person and the named family member".
 */
export function loosens(before: Mandate, after: Mandate): boolean {
  if (after.ceiling_out_of_network > before.ceiling_out_of_network) return true;
  if (after.lapses_at > before.lapses_at) return true;
  if (before.co_signers.some((k) => !after.co_signers.includes(k))) return true;
  // §16.1. Widening a ceiling and shortening cooling loosen for the same
  // reason raising the out-of-network ceiling does: each takes away a
  // protection the person put there, so each needs every co-signer the
  // previous version named.
  if (widens(before.ceiling_daily, after.ceiling_daily)) return true;
  return shortens(before.cooling_seconds, after.cooling_seconds);
}

/** Null is no ceiling, so moving to null widens and moving off it does not. */
function widens(before: number | null, after: number | null): boolean {
  if (after === null) return before !== null;
  if (before === null) return false;
  return after > before;
}

/** Null is no cooling, so moving to null shortens and moving off it does not. */
function shortens(before: number | null, after: number | null): boolean {
  if (after === null) return before !== null;
  if (before === null) return false;
  return after < before;
}

/** A claim above this cannot be one a household reached, and signing it would leave no room to follow. */
const MAX_CLAIMED_VERSION = 2 ** 20;

export class MandateRegister {

  /** §13.2. Where this register keeps what it holds. Unset is in memory. */
  constructor(store: Store = inMemoryStore()) {
    this.rows = store.map("mandates");
    this.claims = store.map("mandate_claims");
  }

  private readonly rows: Map<string, Mandate>;
  /**
   * §14.2, question 56, decided 2026-09-18. **What a move carries is a claim
   * and not a proof.** The import route authenticates nobody, and measured on
   * the engine the day it was decided, a stranger planted a second mandate
   * under a household's own identifier with a ceiling of 9,999,999 and no
   * cooling window, beside that household's real one at a ceiling of 0.
   *
   * Carrying the signatures instead was refused twice over: §16.1 requires
   * that a signature is verified at submission and not retained, and an
   * assertion names the host it was made for, so a member who holds a passkey
   * and nothing else, which is every member who joined through a hub, could
   * move no mandate at all.
   *
   * So a claim is held here until the household signs it at this host. An
   * offer cannot name one, because `get` does not answer for it; a household
   * holding one counts as holding a mandate, because `forHousehold` does, so
   * §16.2 refuses every offer and **nothing settles for that household until
   * the person signs**. That cost is the price of a move carrying a claim.
   */
  private readonly claims: Map<string, Mandate>;

  get(id: string): Mandate | undefined {
    return this.rows.get(id);
  }

  /**
   * Clause 52, and §14.2. A mandate is the person's standing protections, so a
   * move that leaves it behind hands the receiving host a member with no
   * ceiling, no co-signers and no lapse. It was outside the export until
   * 2026-09-09, which is what `exit/` now asks about rather than trusting.
   */
  forHousehold(household: string): Mandate[] {
    return [...this.rows.values()].filter((m) => m.household === household);
  }

  /** The claim held for an identifier, which is not a mandate until it is signed. */
  claimFor(id: string, now = Date.now()): Mandate | undefined {
    const claim = this.claims.get(id);
    // A claim that has lapsed can never be signed, because `record` refuses a
    // lapsed mandate, so it is not one this host offers and not one that keeps
    // the identifier. A refutation pass on 2026-09-18 measured the other way:
    // the acceptance flow writes a claim with a week's lapse, and a household
    // that did not sign within the week could never sign and no route removed
    // the row. **No attacker was needed for that one, only a week.**
    return claim && claim.lapses_at > now ? claim : undefined;
  }

  /**
   * The claims held for a household, which are what it may sign here and
   * **nothing else**. They are not in `forHousehold`, and the reason is the
   * whole of what the first build of this decision got wrong.
   *
   * A claim counted as a mandate the household held, so that a move would fail
   * closed. A refutation pass on 2026-09-18 measured what that bought: the
   * import route authenticates nobody, so **one unsigned POST froze any
   * household on the host**, including one that held no mandate at all and had
   * never moved anywhere. Every offer naming any label was then refused, a
   * settlement already decided could not be paid, and nothing removed a claim,
   * because the only deletion is a successful `record` and the import may
   * carry `lapses_at: 0`, which `record` refuses as lapsed for ever.
   *
   * So a claim does nothing. A household that has moved and not yet signed is
   * a household that has set no protection here, which is what §16.2 already
   * says of every household before its first mandate. **The cost is that the
   * protections do not apply until the person signs**, and the cost of the
   * other direction was that anybody could stop anybody from being sold to.
   */
  claimsFor(household: string, now = Date.now()): Mandate[] {
    return [...this.claims.values()].filter((m) => m.household === household && m.lapses_at > now);
  }

  /**
   * §14.2. A move writes a claim. An identifier this host already holds, as a
   * mandate or as a claim, is left as it is, for the reason §14.2 gives: the
   * row that arrived second decided nothing about the one that arrived first.
   */
  importMandate(m: Mandate, now = Date.now()): void {
    if (this.rows.has(m.id) || this.claimFor(m.id, now)) return;
    // A claim that has already lapsed can never be signed, so keeping it as one
    // that might is a row nobody can act on. Named by a refutation pass on
    // 2026-09-18, which measured an import carrying `lapses_at: 0`.
    if (m.lapses_at <= now) return;
    // A version no household reaches, kept here, is one whose signing freezes
    // the mandate: the next version would be refused as having no room. The
    // bound leaves room for every version a household could ever record.
    if (!Number.isSafeInteger(m.version) || m.version < 1 || m.version > MAX_CLAIMED_VERSION) return;
    this.claims.set(m.id, { ...m, co_signers: [...m.co_signers] });
  }

  mustGet(id: string, now = Date.now()): Mandate {
    const m = this.rows.get(id);
    if (!m) throw notFound(`no mandate ${id}`);
    if (m.lapses_at <= now) {
      throw unprocessable("lapsed", `mandate ${id} lapsed and was not renewed`);
    }
    return m;
  }

  /**
   * Record a mandate, or a new version of one. Every version is signed by the
   * household; a version that loosens is signed by every co-signer the
   * previous version named as well.
   */
  record(input: {
    mandate: Mandate;
    /** §16.1. A key's own signature over the canonical bytes. */
    signatures: Record<string, string>;
    /**
     * §16.1. Or the assertion a passkey makes instead, whose challenge is
     * those bytes. A person who joined through a hub holds a passkey and
     * nothing else, and until 2026-09-11 this route took a bare signature
     * alone: that member could record no ceiling, no cooling window and no
     * co-signer, so §16 was unreachable for them and §16.5 with it.
     */
    assertions: Record<string, Assertion>;
    keyOf: (key: string) => string | undefined;
    /** §14b. The name a member's device signs for, which an assertion names. */
    relyingPartyId: string;
    now?: number;
  }): Mandate {
    const { mandate, signatures, assertions, keyOf, relyingPartyId } = input;
    const now = input.now ?? Date.now();
    // §13.2, question 55. A household's identifier is its key and a mandate's
    // is that identifier with a label, so the signature below is checked
    // against a key nobody could have held by registering a name first.
    if (!isHouseholdName(mandate.household)) {
      throw unprocessable("name_is_not_the_key", `${mandate.household} is not a household identifier`);
    }
    if (householdOfMandate(mandate.id) !== mandate.household) {
      throw unprocessable("name_is_not_the_key", `mandate ${mandate.id} is not this household's`);
    }
    // **A co-signer's name is a name a signature is checked against**, so it is
    // a key too. Found by a refutation pass on 2026-09-16 and measured: a
    // stranger registered `mum`, a household recorded its first version naming
    // `mum` as a co-signer, which needs nobody else's signature, and every
    // loosening after that was the stranger's to sign and not the real
    // co-signer's. Clause 47 rests on who the named people are, so the defect
    // question 55 closed for a household reached through this one name.
    for (const k of mandate.co_signers) {
      if (!isHouseholdName(k)) {
        throw unprocessable("name_is_not_the_key", `co-signer ${k} is not a key`);
      }
    }
    const before = this.rows.get(mandate.id);
    // §14.2, question 56. A claim is **an offer to sign and never a
    // constraint**: it counts only when what is submitted is the claim itself,
    // byte for byte. Checking the version alone let a household record its own
    // terms at the claim's version, which dropped the co-signers it had named
    // elsewhere: clause 47 escaped by relocation, measured 2026-09-18. And
    // binding the claim's terms instead would let a planted row with a
    // co-signer nobody holds freeze that identifier for ever, which is the
    // defect question 56's first attempt was refused for.
    const held = before ? undefined : this.claimFor(mandate.id, now);
    const claim = held && canonicalMandate(held, relyingPartyId).equals(canonicalMandate(mandate, relyingPartyId)) ? held : undefined;
    // Whose row this is comes before which version it is: a row held for
    // another household is not a version of this household's mandate at all.
    if ((before ?? claim) && (before ?? claim)!.household !== mandate.household) {
      throw unprocessable("wrong_household", "a mandate does not change hands");
    }
    if (before && mandate.version !== before.version + 1) {
      throw conflict(
        "stale_version",
        `mandate ${mandate.id} is at version ${before.version}`
      );
    }
    // §14.2, question 56. Nothing checks the claim's version here, because the
    // version is inside the canonical bytes: a submission that is the claim
    // carries the claim's version by construction. It was a separate check
    // until the claim stopped being matched by version alone, on 2026-09-18.
    // §16.1. A version that cannot be incremented stops rising, and the version
    // is what keeps an old signature off a new record: at 2^53 a household
    // tightened a ceiling at the same number and its own earlier submission
    // replayed the loose one back. Measured by a refutation pass on 2026-09-18.
    if (!Number.isSafeInteger(mandate.version) || mandate.version < 1 || mandate.version >= Number.MAX_SAFE_INTEGER) {
      throw unprocessable("stale_version", `version ${mandate.version} is not one a version can follow`);
    }
    // A mandate with no signed history here starts at version 1 unless what is
    // submitted is the claim itself. For a day this let the household state
    // the version wherever a claim was held, and a third refutation pass
    // measured what that reopened: a raw signature is not bound to a host, so
    // any looser version the household ever signed could be recorded at a
    // host it moved to, over its own tighter claim. The cost of the rule is
    // the one the second pass named, that a stranger's claim makes the
    // household start again at 1, and that costs a number and not a protection.
    if (!before && !claim && mandate.version !== 1) {
      throw unprocessable("stale_version", "a new mandate starts at version 1");
    }
    if (mandate.lapses_at <= now) {
      throw unprocessable("lapsed", "a mandate that has already lapsed cannot be recorded");
    }

    const required = new Set<string>([mandate.household]);
    if (before && loosens(before, mandate)) {
      // Clause 47. Nothing else changes it: not the person alone, not the
      // co-signer alone, and no layer, which holds no key at all.
      for (const k of before.co_signers) required.add(k);
    }
    const bytes = canonicalMandate(mandate, relyingPartyId);
    for (const key of required) {
      const pem = keyOf(key);
      const signature = signatures[key];
      const assertion = assertions[key];
      if (signature !== undefined && assertion !== undefined) {
        throw badRequest(
          "malformed",
          `${key} sent a signature and an assertion; exactly one covers a change`
        );
      }
      if (!pem || (signature === undefined && assertion === undefined)) {
        throw unprocessable(
          "unsigned",
          `this change is signed by ${[...required].join(" and ")}; ${key} is missing`
        );
      }
      let ok = false;
      try {
        ok = verifyPersonal(
          bytes,
          signature !== undefined ? { signature } : { assertion: assertion! },
          pem,
          relyingPartyId
        );
      } catch {
        ok = false;
      }
      if (!ok) {
        throw unprocessable("bad_signature", `the signature of ${key} does not cover this mandate`);
      }
    }
    this.rows.set(mandate.id, mandate);
    this.claims.delete(mandate.id);
    return mandate;
  }
}
