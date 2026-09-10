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
};

/** The register in this process. What the reference runs when it presents both roles. */
export class LocalMandates implements MandateSource {
  constructor(private readonly rows: { get(id: string): Mandate | undefined }) {}
  async get(id: string): Promise<Mandate | undefined> {
    return this.rows.get(id);
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
    return (await response.json()) as Mandate;
  }
}
