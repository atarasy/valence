/**
 * §6.6a, decided 2026-09-23. A refund the merchant made and recorded as a
 * §6.6 correction can come back: the card issuer returns it weeks later and
 * the household never receives the money. The correction stays, because the
 * merchant did refund, and the household is still owed the amount. So the
 * merchant appends a second signed record beside the correction saying the
 * refund was returned, and a third saying it was repaid another way.
 *
 * Neither moves money and neither changes the net: the correction already
 * lowered what the household pays, and what it is owed now is the merchant's
 * to settle with it directly.
 */
import { verifyBy } from "./decisions.js";

export const RETURN_STATES = ["returned", "repaid"] as const;
export type ReturnState = (typeof RETURN_STATES)[number];

export type CorrectionReturn = {
  /** The id of a refund correction on this offer. */
  correction: string;
  offer: string;
  /** The correction's own merchant, which signs this record. */
  merchant: string;
  state: ReturnState;
  /** The merchant's own words, shown to the household as written. */
  note: string;
  at: number;
  signature: string;
};

/**
 * The bytes a merchant signs, in the same form as a correction's: every free
 * part percent-encoded, so a relay cannot move the boundary between two fields
 * under a signature that still verifies, and a first line naming the form, so
 * these bytes can never verify as a correction or any other signed object.
 */
export function canonicalCorrectionReturn(r: Omit<CorrectionReturn, "signature">): Buffer {
  const parts = [
    "valence-correction-return/1",
    encodeURIComponent(r.correction),
    encodeURIComponent(r.offer),
    encodeURIComponent(r.merchant),
    r.state,
    encodeURIComponent(r.note),
    String(r.at),
  ];
  return Buffer.from(parts.join("\n"), "utf8");
}

export function verifyCorrectionReturn(r: CorrectionReturn, publicKeyPem: string): boolean {
  return verifyBy(publicKeyPem, canonicalCorrectionReturn(r), Buffer.from(r.signature, "base64"));
}

/**
 * The records to show, oldest first by `at` and then by arrival. The sort is
 * stable, so the arrival order stored is the tie-break.
 */
export function returnsInOrder(held: readonly CorrectionReturn[]): CorrectionReturn[] {
  return held.map((r) => ({ ...r })).sort((a, b) => a.at - b.at);
}

/**
 * What the household is still owed: every refund correction whose refund came
 * back and that the merchant has not reported repaid.
 */
export function owedFor(
  corrections: readonly { id: string; kind: string; amount: number }[],
  held: readonly CorrectionReturn[]
): number {
  let owed = 0;
  for (const c of corrections) {
    if (c.kind !== "refund") continue;
    const mine = held.filter((r) => r.correction === c.id);
    if (mine.some((r) => r.state === "returned") && !mine.some((r) => r.state === "repaid")) owed += c.amount;
  }
  return owed;
}
