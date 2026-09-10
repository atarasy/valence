import { inMemoryStore, type Store } from "../common/store.js";
import { notFound, unprocessable } from "../common/errors.js";

/**
 * Carriage and where the parcel is. §7.5b.
 *
 * This lives in `hub/` because it is the person's side of the wall, and the
 * wall is clause 49: no identity and no payment credential reaches the
 * merchant. A carrier's tracking number is not an address and resolves to one,
 * so a merchant holding it can read where the household lives without ever
 * having a field for it. The absence of the field is not the protection.
 *
 * The presenter learns what happened to the goods from the state machine and
 * from the recovery of §11, and wants nothing from a carrier.
 */
export type DeliveryStatus = "placed" | "in_transit" | "delivered" | "returned";

export type Delivery = {
  offer: string;
  /** What carriage costs on this offer, in the smallest unit. `17` §2b. */
  carriage: number;
  /** The delivery code clause 49 admits, in place of a name and an address. */
  code: string;
  status: DeliveryStatus;
  updated_at: number;
};

const ORDER: DeliveryStatus[] = ["placed", "in_transit", "delivered", "returned"];

export class DeliveryRegister {

  /** §13.2. Where this register keeps what it holds. Unset is in memory. */
  constructor(store: Store = inMemoryStore()) {
    this.rows = store.map("delivery");
  }

  private readonly rows: Map<string, Delivery>;

  record(input: {
    offer: string;
    carriage: number;
    code: string;
    status: DeliveryStatus;
    now?: number;
  }): Delivery {
    if (!Number.isInteger(input.carriage) || input.carriage < 0) {
      throw unprocessable("bad_carriage", "carriage is a whole number of the smallest unit, and never negative");
    }
    if (!ORDER.includes(input.status)) {
      throw unprocessable("bad_status", `status is one of ${ORDER.join(", ")}`);
    }
    const row: Delivery = {
      offer: input.offer,
      carriage: input.carriage,
      code: input.code,
      status: input.status,
      updated_at: input.now ?? Date.now(),
    };
    this.rows.set(input.offer, row);
    return row;
  }

  mustGet(offer: string): Delivery {
    const row = this.rows.get(offer);
    if (!row) throw notFound(`no delivery for offer ${offer}`);
    return row;
  }

  forHousehold(offers: string[]): Delivery[] {
    return offers.map((o) => this.rows.get(o)).filter((d): d is Delivery => d !== undefined);
  }

  importRows(rows: Delivery[]): void {
    for (const r of rows) this.rows.set(r.offer, { ...r });
  }
}
