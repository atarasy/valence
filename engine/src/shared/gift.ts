import { challengeForBytes } from "./decisions.js";

/**
 * §12, question 64, decided 2026-09-19. What a giver signs before a gift is
 * presented. A ceremonial offer charges its giver, and until this question the
 * giver was whatever household the presenter wrote: measured by a refutation
 * pass that day, a household named as giver was charged 1500 without any act
 * of its own, and after question 60 its own purchases were then refused on
 * its daily ceiling. The bytes name the offer, both households, the presenter,
 * the band and the most the gift can come to, so a signature authorises this
 * gift at this bound and no other.
 */
export const GIFT_DOMAIN = "valence.gift.2";

export type GiftTerms = {
  /**
   * Question 58, decided 2026-09-19. The host the gift is presented at, which
   * is the relying party it asserts for. The first form named none, and what
   * stopped a signature being replayed at another host was only that this
   * host mints the offer id; an implementation that let a presenter choose
   * one would have inherited question 58 for gifts in full. Named by the
   * third refutation pass over question 64.
   */
  host: string;
  offer: string;
  giver: string;
  recipient: string;
  presenter: string;
  price_band: { min: number; max: number };
  upper_bound: number;
  expires_at: number;
};

export function canonicalGift(t: GiftTerms): Buffer {
  // The names are percent-encoded, as §16.1's co-signers are. A presenter's
  // name is first-come and was free to hold the separator, so two different
  // sets of terms could be the same bytes; measured by the same pass with a
  // newline in the giver, which question 58 also closes by requiring a key.
  const name = (v: string) => encodeURIComponent(v);
  return Buffer.from(
    [GIFT_DOMAIN, name(t.host), t.offer, name(t.giver), name(t.recipient), name(t.presenter), String(t.price_band.min), String(t.price_band.max), String(t.upper_bound), String(t.expires_at)].join("\n"),
    "utf8"
  );
}

/** §10.5's challenge form of the same bytes, for a passkey. */
export function challengeForGift(t: GiftTerms): string {
  return challengeForBytes(canonicalGift(t));
}
