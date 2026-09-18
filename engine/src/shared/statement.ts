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
 *   valence.statement.1
 *   <offer id>
 *   <carriage>
 *   <candidate>:<valence>:<amount>:<"disputed" or empty>   (one line per
 *   kept, defaulted or consumed candidate and per candidate the collection
 *   recorded missing, ascending candidate id, UTF-8, "\n" between lines)
 *
 * **The first line is a domain tag and it is there on purpose.** A decided
 * set is signed as `<offer id>` then `<candidate>:<valence>:<kept_as>:<lineage>`
 * (§10.5), which is the same prefix and the same four-field shape; the two
 * differ today only because a decision's third field is a word and a
 * statement's is a number. A future valence, or a numeric `kept_as`, would
 * make one signature verify as the other. The tag costs one line now and
 * cannot be added once signatures are in the wild. Added 2026-09-12 by a
 * refutation pass.
 *
 * The amount is the line's own: `unit_price * quantity`, or 0 for a gift
 * (§6.2). A disputed line is a consumed line the household does not confirm:
 * it is not charged, and what is owed for it is between the merchant and the
 * household outside this record.
 *
 * **A line the collection recorded missing is in the statement, at 0, and
 * may be disputed** (question 46, decided 2026-09-14). It is never charged
 * (§3.2), but it is a merchant's statement about goods in a household's home,
 * and until then the household never saw it and could not contest it. A
 * candidate the deadline made `lost` is not in it: nobody said anything about
 * the home. The offer alone cannot tell the two apart, so the collection's
 * `missing` list is passed in.
 */
export type StatementLine = {
  candidate: string;
  valence: "kept" | "defaulted" | "consumed" | "lost";
  amount: number;
  disputed: boolean;
};

export function statementLines(
  offer: Offer,
  disputed: readonly string[],
  missing: readonly string[] = []
): StatementLine[] {
  const lines: StatementLine[] = [];
  for (const c of offer.candidates) {
    if (c.valence === "lost" && missing.includes(c.id)) {
      lines.push({ candidate: c.id, valence: "lost", amount: 0, disputed: disputed.includes(c.id) });
      continue;
    }
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

/** §6.5. The lines a household may dispute: the collection's, never its own. */
export function disputable(offer: Offer, candidate: string, missing: readonly string[] = []): boolean {
  const c = offer.candidates.find((x) => x.id === candidate);
  return c !== undefined && (c.valence === "consumed" || (c.valence === "lost" && missing.includes(c.id)));
}

export const STATEMENT_DOMAIN = "valence.statement.1";

export function canonicalStatement(
  offerId: string,
  // §6.5, §7.5b, 法11条1号, question 40 decided 2026-09-13. **The one item the
  // statute puts on this screen beside the price, and the signature covered
  // the lines and not it**: a household read a carriage, signed, and had no
  // record anywhere that it had. It is a whole number and never null here,
  // because `settle` refuses a statement with no delivery recorded, so the
  // `null` that means "nothing was ever recorded" cannot reach these bytes.
  carriage: number,
  lines: readonly StatementLine[]
): Buffer {
  const body = [...lines]
    .sort((a, b) => (a.candidate < b.candidate ? -1 : a.candidate > b.candidate ? 1 : 0))
    .map((l) => `${l.candidate}:${l.valence}:${l.amount}:${l.disputed ? "disputed" : ""}`);
  return Buffer.from([STATEMENT_DOMAIN, offerId, String(carriage), ...body].join("\n"), "utf8");
}

/** §10.5's challenge form of the same bytes, for a passkey. */
export function challengeForStatement(
  offerId: string,
  carriage: number,
  lines: readonly StatementLine[]
): string {
  return challengeForBytes(canonicalStatement(offerId, carriage, lines));
}

/**
 * Whether a physical offer's settlement needs the household's signature:
 * when the collection found something used, or recorded something missing
 * (question 46). A box that came back with everything unopened, or whose kept
 * lines the household signed at the decision, has nothing in it the household
 * has not already signed for.
 */
/**
 * §14.2 and §6.4, question 57. Whether an offer that has not settled still has
 * a line a settlement would charge: kept, defaulted or consumed, or one the
 * collection recorded lost. A fourth refutation pass measured two that the
 * first rule let travel: a digital offer kept in part and then expired, and a
 * ceremonial offer defaulted. Both held a reserve at the host they left and
 * could never settle at the one they reached.
 */
export function owesSettlement(offer: Offer): boolean {
  return offer.candidates.some((c) => c.valence === "kept" || c.valence === "defaulted" || c.valence === "consumed" || c.valence === "lost");
}

export function needsStatement(offer: Offer, missing: readonly string[] = []): boolean {
  return (
    offer.binding === "physical" &&
    offer.candidates.some((c) => c.valence === "consumed" || (c.valence === "lost" && missing.includes(c.id)))
  );
}
