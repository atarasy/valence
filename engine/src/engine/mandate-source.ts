import { unprocessable } from "../common/errors.js";
import type { Mandate } from "../hub/mandates.js";

/**
 * §13.1. Where the engine reads a person's protections from.
 *
 * A deployment that presents both roles reads its own register. One that
 * presents the engine alone has no register to read, and asks the hub over the
 * endpoints the specification already defines, rather than by reaching into a
 * store it does not own. What it asks for is a protection and not data about a
 * person: a ceiling, the categories that need a second signature, the length of
 * a cooling window.
 *
 * The interface is deliberately narrow. `get` is all the engine needs, and the
 * engine has no way to write a mandate: loosening one is the person's business
 * and their co-signers' (§16.1), and an engine that could write would be a
 * party to a change it is not party to.
 */
export type MandateSource = {
  get(id: string): Promise<Mandate | undefined>;
  /**
   * §16.2, question 56. **Whether this household has any mandate here**, so
   * that an offer naming one it does not have can be refused. `get` alone
   * cannot say: an unknown mandate is left alone, and a presenter that named a
   * label the household never recorded got an offer with no ceiling and no
   * cooling window, having recorded nothing and forged nothing. Measured
   * 2026-09-16.
   *
   * It answers one bit rather than the rows, because a route should carry what
   * its caller needs and no more. **It defends nothing**: the household's own
   * export already hands every mandate to whoever asks, and a presenter can
   * read this bit by presenting under a label of its own and reading the
   * answer. What closes that read is question 41's authenticated one.
   */
  holdsAny(household: string): Promise<boolean>;
  /**
   * §12 and §16.3, question 60, decided 2026-09-19. **The tightest daily
   * ceiling among this household's mandates, or null where none sets one.**
   * A ceremonial offer names the recipient's mandate and charges the giver,
   * and the ceiling was read from the recipient's: measured on 2026-09-19, a
   * giver with a ceiling of 500 was charged 1200 and a recipient with a
   * ceiling of 500 had the gift refused. A daily ceiling protects the person
   * whose money moves, so the giver's is the one read. A gift names no mandate
   * of the giver's, so the tightest of them governs.
   *
   * Question 68, decided 2026-09-19, reads it for a household's own offers
   * too: a household holds several mandates and its own offers named one.
   */
  dailyCeilingOf(household: string, now?: number): Promise<number | null>;
  /**
   * Clause 46, §12, question 65, decided 2026-09-19. **The tightest
   * out-of-network ceiling among this household's mandates, or null where it
   * holds none.** The mirror of question 60 at presentation: a gift charges
   * its giver and the ceiling was read from the recipient's mandate, so a
   * recipient with a ceiling of 0 had a gift it pays nothing for refused, and
   * a giver with a ceiling of 0 was charged 1,200 outside the network.
   * Measured by the third refutation pass over question 64.
   *
   * Question 68, decided the same day, reads it for a household's own offers
   * too, and clause 47 is what that closes. `MandateRegister.record` asks for
   * the co-signers of the version it is replacing, so a household holding
   * `<household>.1` with a ceiling of 0 and a co-signer recorded
   * `<household>.2` at version 1, alone, with any ceiling it liked, and
   * presented under the second: measured 2026-09-19, loosening `.1` was
   * refused `unsigned` and an offer of 1,200 entirely out of network
   * presented under `.2`. A protection a household can walk around by writing
   * a second label is not one, so every mandate it holds binds every offer it
   * makes.
   */
  outOfNetworkCeilingOf(household: string, now?: number): Promise<number | null>;
  /**
   * §16.5, question 68, decided 2026-09-19. **The tightest cooling window
   * among this household's live mandates, which is the longest, or null where
   * none sets one.** The same escape: a household with a window on one label
   * settled at once under a second.
   */
  coolingSecondsOf(household: string, now?: number): Promise<number | null>;
};

/** §16.3. The tightest `ceiling_daily` among the rows, or null. */
export function tightestDailyCeiling(rows: Mandate[], now = Date.now()): number | null {
  let tightest: number | null = null;
  for (const m of rows) {
    // A lapsed mandate governs nothing, and a second refutation pass measured
    // one with a ceiling of 100 refusing a gift under a live one of 100,000.
    if (m.lapses_at <= now) continue;
    if (m.ceiling_daily == null) continue;
    if (tightest === null || m.ceiling_daily < tightest) tightest = m.ceiling_daily;
  }
  return tightest;
}

/**
 * Clause 46, §16.2. The tightest `ceiling_out_of_network` among the rows, or
 * null where there are no live ones. A lapsed mandate governs nothing, for
 * the reason above: its ceiling would otherwise refuse under a live one.
 *
 * `ceiling_out_of_network` is not nullable, so every live row has one and the
 * null here means "this household holds no live mandate", which is the state
 * §16.2 leaves alone.
 */
export function tightestOutOfNetworkCeiling(rows: Mandate[], now = Date.now()): number | null {
  let tightest: number | null = null;
  for (const m of rows) {
    if (m.lapses_at <= now) continue;
    if (tightest === null || m.ceiling_out_of_network < tightest) tightest = m.ceiling_out_of_network;
  }
  return tightest;
}

/**
 * §16.5. The tightest cooling window among the rows, **which is the longest**:
 * a window is time in which a signed set can be taken back, so more of it is
 * more protection, and this is the one place in §16 where the tightest value
 * is the larger one. Null is no window and is skipped rather than treated as
 * zero, exactly as `tightestDailyCeiling` skips a null ceiling.
 */
export function longestCooling(rows: Mandate[], now = Date.now()): number | null {
  let longest: number | null = null;
  for (const m of rows) {
    if (m.lapses_at <= now) continue;
    if (m.cooling_seconds == null) continue;
    if (longest === null || m.cooling_seconds > longest) longest = m.cooling_seconds;
  }
  return longest;
}

/**
 * §13.1, question 68. What a hub may answer for one of the household route's
 * protections: null, meaning it sets none, or a whole number of currency
 * units or seconds. **Absent is neither**, and the callers below refuse it
 * rather than read it as null, because a hub that predates a protection would
 * otherwise turn that protection off for every household it holds.
 */
function readableNonNegative(value: unknown): boolean {
  return value === null || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
}

/** The register in this process. What the reference runs when it presents both roles. */
export class LocalMandates implements MandateSource {
  constructor(
    private readonly rows: {
      get(id: string): Mandate | undefined;
      forHousehold(household: string): Mandate[];
    }
  ) {}
  async get(id: string): Promise<Mandate | undefined> {
    return this.rows.get(id);
  }
  async holdsAny(household: string): Promise<boolean> {
    return this.rows.forHousehold(household).length > 0;
  }
  // The engine's own clock, so that a giver's lapse is read against the same
  // moment as the recipient's (the fifth refutation pass over question 66).
  async dailyCeilingOf(household: string, now = Date.now()): Promise<number | null> {
    return tightestDailyCeiling(this.rows.forHousehold(household), now);
  }
  async outOfNetworkCeilingOf(household: string, now = Date.now()): Promise<number | null> {
    return tightestOutOfNetworkCeiling(this.rows.forHousehold(household), now);
  }
  async coolingSecondsOf(household: string, now = Date.now()): Promise<number | null> {
    return longestCooling(this.rows.forHousehold(household), now);
  }
}

/**
 * The hub, over HTTP. `GET /_node/mandates/{id}` is the route the hub already
 * answers, and §13.1 puts it on the hub's side.
 *
 * **A hub that cannot be reached is not a hub that says there is no mandate.**
 * An engine that read a timeout as "no mandate" would drop every protection
 * the moment the network did, which is the direction that fails open. So a
 * transport failure refuses the request instead.
 */
export class RemoteMandates implements MandateSource {
  constructor(
    private readonly base: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async get(id: string): Promise<Mandate | undefined> {
    let response: Response;
    try {
      response = await this.fetchImpl(
        `${this.base.replace(/\/+$/, "")}/_node/mandates/${encodeURIComponent(id)}`,
        { headers: { accept: "application/json" } }
      );
    } catch (err) {
      throw unprocessable(
        "hub_unreachable",
        `the hub holding mandate ${id} could not be reached: ${(err as Error).message}`
      );
    }
    if (response.status === 404) {
      // The hub answered and does not hold it. A mandate this deployment does
      // not hold is left alone, which is what the engine does with an unknown
      // mandate anyway: refusing every offer would be a gate, not a protection.
      return undefined;
    }
    if (!response.ok) {
      throw unprocessable(
        "hub_refused",
        `the hub answered ${response.status} for mandate ${id}`
      );
    }
    // The same reading as `holdsAny` below: a body this engine cannot parse is
    // not a mandate, and reading it as one leaves every field undefined, which
    // is a mandate that refuses nothing.
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw unprocessable(
        "hub_refused",
        `the hub answered mandate ${id} in a form this engine could not read`
      );
    }
    if (!body || typeof body !== "object" || typeof (body as Mandate).household !== "string") {
      throw unprocessable("hub_refused", `the hub answered mandate ${id} without a household`);
    }
    return body as Mandate;
  }

  /**
   * §16.2, question 56. The hub answers whether a household has any mandate,
   * over `GET /_node/mandates?household={id}`, which carries `has` and not the
   * rows. A hub that cannot be reached, and one that answers in a shape this
   * engine cannot read, are neither of them a hub that says there are none.
   */
  async holdsAny(household: string): Promise<boolean> {
    const has = (await this.household(household)).has;
    if (typeof has !== "boolean") {
      throw unprocessable(
        "hub_refused",
        `the hub answered ${household}'s mandates without saying whether there are any`
      );
    }
    return has;
  }

  /**
   * §16.3, question 60. The same route carries the tightest daily ceiling. A
   * hub that answers without it is one that predates the question, and
   * reading its silence as "no ceiling" would charge a giver past the ceiling
   * it set, so it refuses instead.
   */
  async dailyCeilingOf(household: string): Promise<number | null> {
    const ceiling = (await this.household(household)).ceiling_daily;
    if (!readableNonNegative(ceiling)) {
      throw unprocessable(
        "hub_refused",
        `the hub answered ${household}'s mandates without a daily ceiling it could read`
      );
    }
    return ceiling as number | null;
  }

  /**
   * Clause 46, §16.2, questions 65 and 68. The same route carries the tightest
   * out-of-network ceiling. A hub that answers without it is one that predates
   * the questions, and reading its silence as "no ceiling" would present a
   * gift past the ceiling its giver set, or an offer past the ceiling the
   * household set on another of its labels, which is the escape question 68
   * closes. So it refuses instead, as `dailyCeilingOf` does.
   */
  async outOfNetworkCeilingOf(household: string): Promise<number | null> {
    const ceiling = (await this.household(household)).ceiling_out_of_network;
    if (!readableNonNegative(ceiling)) {
      throw unprocessable(
        "hub_refused",
        `the hub answered ${household}'s mandates without an out-of-network ceiling it could read`
      );
    }
    return ceiling as number | null;
  }

  /**
   * §16.5, question 68. And the tightest, which is the longest, cooling
   * window. Silence is refused rather than read as no window, for the reason
   * above: a household that set one on another label would settle at once.
   */
  async coolingSecondsOf(household: string): Promise<number | null> {
    const cooling = (await this.household(household)).cooling_seconds;
    if (!readableNonNegative(cooling)) {
      throw unprocessable(
        "hub_refused",
        `the hub answered ${household}'s mandates without a cooling window it could read`
      );
    }
    return cooling as number | null;
  }

  private async household(household: string): Promise<{
    has?: unknown;
    ceiling_daily?: unknown;
    ceiling_out_of_network?: unknown;
    cooling_seconds?: unknown;
  }> {
    let response: Response;
    try {
      response = await this.fetchImpl(
        `${this.base.replace(/\/+$/, "")}/_node/mandates?household=${encodeURIComponent(household)}`,
        { headers: { accept: "application/json" } }
      );
    } catch (err) {
      throw unprocessable(
        "hub_unreachable",
        `the hub holding the mandates of ${household} could not be reached: ${(err as Error).message}`
      );
    }
    if (!response.ok) {
      throw unprocessable(
        "hub_refused",
        `the hub answered ${response.status} for the mandates of ${household}`
      );
    }
    // **A 200 of the wrong shape is not an answer either.** The sentence above
    // is about a hub that cannot be reached; a hub that answered `{}`, or a
    // page of HTML, would otherwise be read as one saying there are none, and
    // that is the direction that drops the protection. Named by a refutation
    // pass on 2026-09-16, which measured `200 {}` reading as none.
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw unprocessable(
        "hub_refused",
        `the hub answered ${household}'s mandates in a form this engine could not read`
      );
    }
    if (!body || typeof body !== "object") {
      throw unprocessable(
        "hub_refused",
        `the hub answered ${household}'s mandates without saying whether there are any`
      );
    }
    return body as {
      has?: unknown;
      ceiling_daily?: unknown;
      ceiling_out_of_network?: unknown;
      cooling_seconds?: unknown;
    };
  }
}
