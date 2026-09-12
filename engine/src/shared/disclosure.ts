/**
 * §10a. The merchant's own disclosure, which this engine carries and never
 * composes.
 *
 * Every jurisdiction makes a seller tell a buyer certain things before the
 * buyer commits, and none of them makes the seller's software house tell them.
 * So nothing here knows what an item says: the list is the seller's law. What
 * this module holds is the shape, the bytes a merchant signs, and the check
 * that the signature is that merchant's.
 */
import { verifyBy } from "./decisions.js";

export type DisclosureItem = { label: string; value: string };

export type Disclosure = {
  merchant: string;
  version: string;
  items: DisclosureItem[];
  signature: string;
};

/**
 * The bytes a merchant signs. **Every part is percent-encoded before the
 * separators join it**, for the reason §8 and §16.1 escape theirs: a plain
 * join lets whoever relays the block move the boundary between two fields
 * under a signature that still verifies. Measured on the catalogue's own form
 * on 2026-09-12, which was the third place in this codebase with that defect.
 */
export function canonicalDisclosure(d: Omit<Disclosure, "signature">): Buffer {
  const parts = [
    encodeURIComponent(d.merchant),
    encodeURIComponent(d.version),
    ...d.items.map((i) => `${encodeURIComponent(i.label)}=${encodeURIComponent(i.value)}`),
  ];
  return Buffer.from(parts.join("\n"), "utf8");
}

export function verifyDisclosure(d: Disclosure, publicKeyPem: string): boolean {
  return verifyBy(publicKeyPem, canonicalDisclosure(d), Buffer.from(d.signature, "base64"));
}
