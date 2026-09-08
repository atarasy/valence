import { conflict, unprocessable, ValenceError } from "./errors.js";
import type { Ledger, Reservation } from "./ledger.js";

/**
 * A `Ledger` backed by Meter.
 *
 * The mapping is the one §6.4 describes and the handoff asked for: `present`
 * reserves, `settle` commits the actual, `expire` and `withdraw` release, and
 * `offer.id` is the idempotency key. Meter's own primitive is shaped for it,
 * down to the `held | committed | released` status.
 *
 * **The ceiling is enforced here, before anything is delegated.** Meter does
 * not enforce it. Measured on 2026-09-08 against `commitReservedUsage`: a
 * commit above the held amount charges the difference as a
 * `usage_hold_adjustment` and succeeds, failing only when the balance cannot
 * cover it. A funded household is exactly the case that would otherwise pass,
 * so the check cannot be left to the ledger and cannot be skipped when the
 * account looks healthy.
 */
export type MeterConfig = {
  baseUrl: string;
  serviceId: string;
  apiKey: string;
  /** Meter prices per tool. One tool covers every offer this engine settles. */
  tool: string;
  provider: string;
  /** Milliseconds. A ledger that hangs must not hold an offer open. */
  timeoutMs?: number;
};

type MeterReservation = {
  requestId: string;
  credits: number;
  status: "held" | "committed" | "released";
  expiresAt?: number;
};

export class MeterLedger implements Ledger {
  /**
   * The reserved amount, remembered locally.
   *
   * Not an optimisation. The ceiling has to be known before the commit is
   * sent, and asking Meter for it first would make the check a read followed
   * by a write with a gap in between. Holding the number the reserve returned
   * closes the gap, and `get` serves it to the engine.
   */
  private readonly held = new Map<string, Reservation>();

  constructor(private readonly config: MeterConfig) {
    if (!config.baseUrl || !config.serviceId || !config.apiKey) {
      throw new Error("MeterLedger needs baseUrl, serviceId and apiKey");
    }
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs ?? 10_000
    );
    try {
      const response = await fetch(`${this.config.baseUrl}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      const parsed = text === "" ? undefined : JSON.parse(text);
      if (!response.ok) {
        throw new ValenceError(
          response.status === 402 ? 402 : 502,
          "ledger_refused",
          `meter ${path} returned ${response.status}: ${text.slice(0, 200)}`
        );
      }
      return parsed;
    } finally {
      clearTimeout(timer);
    }
  }

  async reserve(input: {
    requestId: string;
    household: string;
    amount: number;
    expiresAt: number;
  }): Promise<Reservation> {
    const existing = this.held.get(input.requestId);
    if (existing) return existing;

    const body = await this.post("/api/v1/meter/authorize", {
      serviceId: this.config.serviceId,
      customerLocalId: input.household,
      tool: this.config.tool,
      provider: this.config.provider,
      credits: input.amount,
      requestId: input.requestId,
    });
    const reservation = (body as { reservation?: MeterReservation }).reservation;
    if (!reservation) {
      throw conflict("no_reservation", "meter authorize returned no reservation");
    }

    const row: Reservation = {
      requestId: input.requestId,
      household: input.household,
      // Meter's own number, not the one that was asked for. If it held less
      // than the offer's upper bound, the ceiling is its number.
      reserved: reservation.credits,
      expiresAt: input.expiresAt,
      status: reservation.status,
      committed: null,
    };
    this.held.set(input.requestId, row);
    return row;
  }

  async commit(input: { requestId: string; amount: number }): Promise<Reservation> {
    const row = this.held.get(input.requestId);
    if (!row) {
      throw conflict("no_reservation", `no reservation for ${input.requestId}`);
    }
    if (row.status === "committed") return row;
    if (row.status === "released") {
      throw conflict("reservation_released", `reservation ${input.requestId} was released`);
    }

    // The ceiling, checked before the call rather than after it. Meter would
    // accept this and charge the difference.
    if (input.amount > row.reserved) {
      throw unprocessable(
        "settlement_exceeds_reserve",
        `settlement of ${input.amount} exceeds the reserved ${row.reserved}`
      );
    }

    await this.post("/api/v1/meter/commit", {
      serviceId: this.config.serviceId,
      customerLocalId: row.household,
      tool: this.config.tool,
      provider: this.config.provider,
      credits: input.amount,
      requestId: input.requestId,
    });
    row.status = "committed";
    row.committed = input.amount;
    return row;
  }

  async release(input: { requestId: string; reason: string }): Promise<Reservation> {
    const row = this.held.get(input.requestId);
    if (!row) {
      throw conflict("no_reservation", `no reservation for ${input.requestId}`);
    }
    if (row.status === "held") {
      await this.post("/api/v1/meter/release", {
        serviceId: this.config.serviceId,
        customerLocalId: row.household,
        requestId: input.requestId,
        reason: input.reason,
      });
      row.status = "released";
      row.committed = 0;
    }
    return row;
  }

  get(requestId: string): Reservation | undefined {
    return this.held.get(requestId);
  }
}
