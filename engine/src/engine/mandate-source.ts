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
};

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
    const has = (body as { has?: unknown } | null)?.has;
    if (typeof has !== "boolean") {
      throw unprocessable(
        "hub_refused",
        `the hub answered ${household}'s mandates without saying whether there are any`
      );
    }
    return has;
  }
}
