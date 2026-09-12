import { unprocessable } from "../common/errors.js";
import type { Delivery } from "../hub/delivery.js";

/**
 * §13.1, §7.5b, §6.5. Where the engine reads a delivery from.
 *
 * **The delivery register is the hub's** and the routes that render it are the
 * engine's, which is the shape that made this necessary. `GET /offers/{id}/approval`
 * and `GET /offers/{id}/statement` both carry the carriage, both live under an
 * offer's path, and an offer is the engine's. A refutation pass on 2026-09-12
 * measured what that costs on a split deployment: the engine holds no register,
 * so both screens rendered `carriage: null` while the hub held a delivery, and
 * a screen that shows no carriage is either a merchant whose price includes it
 * (法11条1号's own parenthesis) or an implementation that never looked. The
 * same two pictures, different facts.
 *
 * So the engine asks, exactly as it asks for a mandate (§16.2) and for the
 * day's total (§16.3). The interface is the third thing on §13.1's list and
 * the last one the screens need.
 */
export type DeliverySource = {
  /** The delivery recorded for this offer, or undefined where none is. */
  find(offer: string): Promise<Delivery | undefined>;
};

/** The register in this process. What the reference runs when it presents both roles. */
export class LocalDeliveries implements DeliverySource {
  constructor(private readonly rows: { find(offer: string): Delivery | undefined }) {}
  async find(offer: string): Promise<Delivery | undefined> {
    return this.rows.find(offer);
  }
}

/**
 * The hub, over `GET /offers/{id}/delivery`, which §13.1 already puts on the
 * hub and which already exists.
 *
 * **A hub that cannot be reached is not a hub that holds no delivery.** Reading
 * a transport failure as an absent delivery would take a statutory item off the
 * screen the moment the network went, which is the direction that fails open
 * and the reason `RemoteMandates` refuses the same way.
 */
export class RemoteDeliveries implements DeliverySource {
  constructor(
    private readonly base: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async find(offer: string): Promise<Delivery | undefined> {
    let response: Response;
    try {
      response = await this.fetchImpl(
        `${this.base.replace(/\/+$/, "")}/offers/${encodeURIComponent(offer)}/delivery`,
        { headers: { accept: "application/json" } }
      );
    } catch (err) {
      throw unprocessable(
        "hub_unreachable",
        `the hub holding the delivery for ${offer} could not be reached: ${(err as Error).message}`
      );
    }
    if (response.status === 404) {
      // The hub answered and holds none. An offer with no delivery recorded is
      // an ordinary state before the parcel goes out.
      return undefined;
    }
    if (!response.ok) {
      throw unprocessable(
        "hub_refused",
        `the hub answered ${response.status} for the delivery of ${offer}`
      );
    }
    return (await response.json()) as Delivery;
  }
}
