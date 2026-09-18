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
export const GIFT_DOMAIN = "valence.gift.1";

export type GiftTerms = {
  offer: string;
  giver: string;
  recipient: string;
  presenter: string;
  price_band: { min: number; max: number };
  upper_bound: number;
  expires_at: number;
};

export function canonicalGift(t: GiftTerms): Buffer {
  return Buffer.from(
    [GIFT_DOMAIN, t.offer, t.giver, t.recipient, t.presenter, String(t.price_band.min), String(t.price_band.max), String(t.upper_bound), String(t.expires_at)].join("\n"),
    "utf8"
  );
}

/** §10.5's challenge form of the same bytes, for a passkey. */
export function challengeForGift(t: GiftTerms): string {
  return challengeForBytes(canonicalGift(t));
}
