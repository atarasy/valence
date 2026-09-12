import type { Offer } from "../common/types.js";
import { challengeForBytes } from "./decisions.js";

/**
 * §6.5. The settlement statement a household signs before a physical box is
 * charged. Question 36, decided 2026-09-12.
 *
 * The collection records what was used as `consumed`, and a household may
 * not name that verdict itself (§11.2). Until 2026-09-12 the reference then
 * charged those lines on the collection's record alone, with no act of the
 * household on any device, which is the one thing the case for distance
 * selling rests on (`09` §6 requirement 1 of the concept documents) and the
 * thing clause 35 forbids: nothing settles on a set other than the one
 * signed. So the collection's record is a proposal, and the household's
 * signature over this statement is the application.
 *
 * What is signed, in this canonical shape, so a signature made by one hub
 * verifies at any conforming endpoint:
 *
 *   <offer id>
 *   <candidate>:<valence>:<amount>:<"disputed" or empty>   (one line per
 *   kept, defaulted or consumed candidate, ascending candidate id, UTF-8,
 *   "\n" between lines)
 *
 * The amount is the line's own: `unit_price * quantity`, or 0 for a gift
 * (§6.2). A disputed line is a consumed line the household does not confirm:
 * it is not charged, and what is owed for it is between the merchant and the
 * household outside this record. Lost lines are not in the statement; they
 * are never charged (§3.2).
 */
export type StatementLine = {
  candidate: string;
  valence: "kept" | "defaulted" | "consumed";
  amount: number;
  disputed: boolean;
};

export function statementLines(offer: Offer, disputed: readonly string[]): StatementLine[] {
  const lines: StatementLine[] = [];
  for (const c of offer.candidates) {
    if (c.valence !== "kept" && c.valence !== "defaulted" && c.valence !== "consumed") continue;
    lines.push({
      candidate: c.id,
      valence: c.valence,
      // §6.2. A gift is never billed to the person who received it.
      amount: c.given_by ? 0 : c.unit_price * c.quantity,
      disputed: c.valence === "consumed" && disputed.includes(c.id),
    });
  }
  return lines;
}

export function canonicalStatement(offerId: string, lines: readonly StatementLine[]): Buffer {
  const body = [...lines]
    .sort((a, b) => (a.candidate < b.candidate ? -1 : a.candidate > b.candidate ? 1 : 0))
    .map((l) => `${l.candidate}:${l.valence}:${l.amount}:${l.disputed ? "disputed" : ""}`);
  return Buffer.from([offerId, ...body].join("\n"), "utf8");
}

/** §10.5's challenge form of the same bytes, for a passkey. */
export function challengeForStatement(offerId: string, lines: readonly StatementLine[]): string {
  return challengeForBytes(canonicalStatement(offerId, lines));
}

/**
 * Whether a physical offer's settlement needs the household's signature:
 * when the collection found something used. A box that came back with
 * everything unopened, or whose kept lines the household signed at the
 * decision, has nothing in it the household has not already signed for.
 */
export function needsStatement(offer: Offer): boolean {
  return offer.binding === "physical" && offer.candidates.some((c) => c.valence === "consumed");
}
