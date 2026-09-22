/**
 * §6.6, question 70, decided 2026-09-22. A correction appended to a settlement
 * the household already signed. The settlement is never rewritten: what was
 * signed stays what was signed, and a later refund or a corrected collection
 * is a second record beside it, so the household's receipt can show the
 * original, each correction and the net.
 *
 * Only a correction that lowers what the household pays is appended here,
 * signed by the merchant of record, and it needs nothing of the household.
 * One that would raise it is a new statement the household signs, and it is
 * not a correction at all (§6.6).
 */
import { verifyBy } from "./decisions.js";

export const CORRECTION_KINDS = ["refund", "collection"] as const;
export type CorrectionKind = (typeof CORRECTION_KINDS)[number];

export type Correction = {
  /** The merchant's own identifier, so a retry is recognisably the same correction. */
  id: string;
  offer: string;
  merchant: string;
  /** Whole yen by which what the household pays is lowered. Always positive. */
  amount: number;
  kind: CorrectionKind;
  /** The merchant's own words, shown to the household as written. */
  note: string;
  corrected_at: number;
  signature: string;
};

/**
 * The bytes a merchant signs. Every part is percent-encoded before the
 * separators join it, for the reason §10a gives its disclosure: a plain join
 * lets whoever relays the record move the boundary between two fields under
 * a signature that still verifies. The first line names the form, so these
 * bytes can never verify as any other signed object's.
 */
export function canonicalCorrection(c: Omit<Correction, "signature">): Buffer {
  const parts = [
    "valence-correction/1",
    encodeURIComponent(c.id),
    encodeURIComponent(c.offer),
    encodeURIComponent(c.merchant),
    String(c.amount),
    c.kind,
    encodeURIComponent(c.note),
    String(c.corrected_at),
  ];
  return Buffer.from(parts.join("\n"), "utf8");
}

export function verifyCorrection(c: Correction, publicKeyPem: string): boolean {
  return verifyBy(publicKeyPem, canonicalCorrection(c), Buffer.from(c.signature, "base64"));
}
