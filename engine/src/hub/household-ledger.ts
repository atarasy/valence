/**
 * §16.3, and clause 38. The person's own copy of what settled for them.
 *
 * `02` §2 of the concept documents has said from the start that a settlement
 * is recorded twice: in the person's node, which is theirs, and in the
 * merchant's vertical ledger, which is the merchant's. The reference had one
 * store doing both jobs, which was invisible while one process held everything
 * and became a defect the day the roles were split: **an engine summing its
 * own settlements is a merchant computing a household's union**, which is what
 * clause 38 keeps a merchant away from, and two engines gave a household two
 * daily ceilings.
 *
 * What is kept here is deliberately thin. An amount, when it settled, and
 * which offer it was, and nothing about what was in it: the daily ceiling
 * needs a sum, and a copy that carried products and merchants would be a
 * second vertical ledger on the person's side rather than the person's own.
 */
export type SettledAmount = {
  offer: string;
  household: string;
  amount: number;
  settled_at: number;
};

export class HouseholdLedger {
  private readonly rows = new Map<string, SettledAmount>();

  /** Idempotent by offer: a settlement reported twice is one settlement. */
  record(row: SettledAmount): SettledAmount {
    this.rows.set(row.offer, { ...row });
    return this.rows.get(row.offer)!;
  }

  /** What settled for this household at or after `since`. */
  since(household: string, since: number): SettledAmount[] {
    return [...this.rows.values()].filter(
      (r) => r.household === household && r.settled_at >= since
    );
  }

  /** §16.3. The sum the daily ceiling is measured against. */
  totalSince(household: string, since: number): number {
    return this.since(household, since).reduce((sum, r) => sum + r.amount, 0);
  }

  forHousehold(household: string): SettledAmount[] {
    return [...this.rows.values()].filter((r) => r.household === household);
  }

  importRows(rows: SettledAmount[]): void {
    for (const r of rows) this.rows.set(r.offer, { ...r });
  }
}
