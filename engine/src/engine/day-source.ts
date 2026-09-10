import { unprocessable } from "../common/errors.js";

/**
 * §16.3. What the engine asks before it settles: how much has already settled
 * for this household today, on the person's side.
 *
 * The engine used to answer this from its own settlements. That was the
 * household's whole union while one process held everything, and became wrong
 * the day the roles were split: two engines, two ceilings. It was also a
 * merchant computing a person's union, which clause 38 keeps away from a
 * merchant. So the question goes to the hub, and the answer comes back as a
 * number rather than as a list of what a household has been buying.
 */
export type DaySource = {
  /** The total that settled for this household at or after `since`. */
  totalSince(household: string, since: number): Promise<number>;
  /** Report a settlement to the person's own copy. */
  report(row: {
    offer: string;
    household: string;
    amount: number;
    settled_at: number;
  }): Promise<void>;
};

/** The ledger in this process. What the reference runs when it presents both roles. */
export class LocalDay implements DaySource {
  constructor(
    private readonly ledger: {
      totalSince(household: string, since: number): number;
      record(row: {
        offer: string;
        household: string;
        amount: number;
        settled_at: number;
      }): unknown;
    }
  ) {}
  async totalSince(household: string, since: number): Promise<number> {
    return this.ledger.totalSince(household, since);
  }
  async report(row: {
    offer: string;
    household: string;
    amount: number;
    settled_at: number;
  }): Promise<void> {
    this.ledger.record(row);
  }
}

/**
 * The hub, over HTTP.
 *
 * **A hub that cannot be reached is not a hub that says nothing has settled.**
 * Reading a transport failure as a total of zero would raise every daily
 * ceiling to its full value the moment the network did, which is the same
 * direction of failure the mandate source refuses (§13.1).
 */
export class RemoteDay implements DaySource {
  constructor(
    private readonly base: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  private url(path: string): string {
    return `${this.base.replace(/\/+$/, "")}${path}`;
  }

  async totalSince(household: string, since: number): Promise<number> {
    let response: Response;
    const path = `/households/${encodeURIComponent(household)}/settled?since=${since}`;
    try {
      response = await this.fetchImpl(this.url(path), {
        headers: { accept: "application/json" },
      });
    } catch (err) {
      throw unprocessable(
        "hub_unreachable",
        `the hub holding this household's day could not be reached: ${(err as Error).message}`
      );
    }
    if (!response.ok) {
      throw unprocessable(
        "hub_refused",
        `the hub answered ${response.status} for this household's day`
      );
    }
    const body = (await response.json()) as { total?: unknown };
    if (typeof body.total !== "number") {
      throw unprocessable("hub_refused", "the hub's answer carried no total");
    }
    return body.total;
  }

  async report(row: {
    offer: string;
    household: string;
    amount: number;
    settled_at: number;
  }): Promise<void> {
    const path = `/households/${encodeURIComponent(row.household)}/settled`;
    let response: Response;
    try {
      response = await this.fetchImpl(this.url(path), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(row),
      });
    } catch (err) {
      throw unprocessable(
        "hub_unreachable",
        `the settlement could not be reported to the hub: ${(err as Error).message}`
      );
    }
    if (!response.ok) {
      throw unprocessable(
        "hub_refused",
        `the hub answered ${response.status} to a settlement report`
      );
    }
  }
}
