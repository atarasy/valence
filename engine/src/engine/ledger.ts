import { conflict, unprocessable } from "./errors.js";

/**
 * The authorising ledger, as §6.4 assumes it: reserve at presentation, commit
 * the actual at settlement, release when nothing is kept. `offer.id` is the
 * idempotency key.
 *
 * The one requirement that is not satisfied by having a reserve-and-commit
 * primitive: **the reserve is a ceiling.** A settlement above it must fail
 * rather than silently exceed what the household authorised.
 *
 * That obligation belongs here, in the adapter, and not to the ledger
 * underneath. Measured against Meter on 2026-09-08, whose
 * `commitReservedUsage` is the primitive this maps onto: a commit above the
 * held amount is not refused. It charges the difference as a
 * `usage_hold_adjustment` and succeeds, and it fails only when the balance
 * cannot cover that difference. **A funded account is exactly the case where
 * the household's authorisation is exceeded quietly.** Meter's own
 * architecture note reads "an estimate below the actual is rejected at
 * commit", which describes the underfunded path only.
 *
 * An earlier version of this comment extended the claim to post-paid accounts
 * inside their credit limit. That was wrong and was corrected the same day
 * after a second reading: the commit path compares the raw balance and never
 * calls `authorizeSpend`, which is the only function that knows about credit
 * limits, so a post-paid account carrying a negative balance is refused
 * rather than waved through. The finding is about funded accounts and only
 * those.
 *
 * So every adapter enforces the ceiling before it delegates. A conformance
 * test for §6.4 that funds the household is the one that catches an adapter
 * that forgot.
 */
export type Reservation = {
  requestId: string;
  household: string;
  reserved: number;
  expiresAt: number;
  status: "held" | "committed" | "released";
  committed: number | null;
};

export interface Ledger {
  reserve(input: {
    requestId: string;
    household: string;
    amount: number;
    expiresAt: number;
  }): Promise<Reservation>;

  /** MUST reject `amount` greater than the reserved amount. */
  commit(input: { requestId: string; amount: number }): Promise<Reservation>;

  release(input: { requestId: string; reason: string }): Promise<Reservation>;

  get(requestId: string): Reservation | undefined;
}

export class InMemoryLedger implements Ledger {
  private readonly rows = new Map<string, Reservation>();

  async reserve(input: {
    requestId: string;
    household: string;
    amount: number;
    expiresAt: number;
  }): Promise<Reservation> {
    const existing = this.rows.get(input.requestId);
    // Idempotent on offer.id: a retry returns the same hold rather than a second one.
    if (existing) return existing;
    const row: Reservation = {
      requestId: input.requestId,
      household: input.household,
      reserved: input.amount,
      expiresAt: input.expiresAt,
      status: "held",
      committed: null,
    };
    this.rows.set(input.requestId, row);
    return row;
  }

  async commit(input: { requestId: string; amount: number }): Promise<Reservation> {
    const row = this.rows.get(input.requestId);
    if (!row) {
      throw conflict("no_reservation", `no reservation for ${input.requestId}`);
    }
    if (row.status === "committed") return row;
    if (row.status === "released") {
      throw conflict(
        "reservation_released",
        `reservation ${input.requestId} was released`
      );
    }
    if (input.amount > row.reserved) {
      throw unprocessable(
        "settlement_exceeds_reserve",
        `settlement of ${input.amount} exceeds the reserved ${row.reserved}`
      );
    }
    row.status = "committed";
    row.committed = input.amount;
    return row;
  }

  async release(input: { requestId: string; reason: string }): Promise<Reservation> {
    const row = this.rows.get(input.requestId);
    if (!row) {
      throw conflict("no_reservation", `no reservation for ${input.requestId}`);
    }
    if (row.status === "held") {
      row.status = "released";
      row.committed = 0;
    }
    return row;
  }

  get(requestId: string): Reservation | undefined {
    return this.rows.get(requestId);
  }
}
