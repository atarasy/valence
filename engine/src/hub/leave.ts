import type { ValenceEngine } from "../engine/offers.js";
import type { RecoveryRegister } from "./node.js";
import type { PermissionLedger } from "./permissions.js";
import type { MandateRegister } from "./mandates.js";
import type { DeliveryRegister } from "./delivery.js";
import type { ApprovalDesk } from "./approval.js";
import type { CarriageQuotes } from "./carriage-quote.js";
import { conflict } from "../common/errors.js";
import { atomically } from "../common/store.js";
import { moneyStillToMove, needsStatement } from "../shared/statement.js";
import { verifyPersonal, type Assertion } from "../shared/decisions.js";
import { unprocessable } from "../common/errors.js";
import type { Offer } from "../common/types.js";

/**
 * §14.3. A household leaves a host, decided by the founder on 2026-09-22.
 *
 * Leaving is not moving (§14, clause 43): nothing is imported anywhere, and
 * this module never talks to another host. What it deletes is the engine's
 * and the hub's own copies of what this host holds of the household's; a
 * merchant keeps its own copy through `valence-merchant/1` (§14.1).
 *
 * `ctx` carries the same registers `exportNode` (`hub/node.ts`) is given,
 * because the two answer related questions over the same rows: an export
 * says what leaves with the node, this says what is refused, and what comes
 * out of the host when nothing is.
 */
export type LeaveContext = {
  engine: ValenceEngine;
  recovery: RecoveryRegister;
  permissions: PermissionLedger;
  mandates: MandateRegister;
  deliveries: DeliveryRegister;
  /** Clause 59's screens, one deliberation per offer. Not part of `exportNode`'s set: an export carries nothing of what a household was shown to decide, only what it decided. */
  approvals: ApprovalDesk;
  /** §7.5b. Absent on a deployment that cannot retain a digital quotation, as `exportNode`'s own `quotes` argument is. */
  quotes?: CarriageQuotes;
};

export type Blocker = { kind: string; id: string };

/** §14.3: the period a seller keeps the records of a sale (法人税法施行規則 59条). */
const SEVEN_YEARS_MS = 7 * 365.25 * 86_400_000;

/** An offer this household pays for: the recipient, or a giver of null or itself. Everything §14.3 deletes is drawn from this set, and nothing else. */
function ownOffers(all: readonly Offer[], household: string): Offer[] {
  return all.filter((o) => o.household === household && (o.giver === null || o.giver === household));
}

/**
 * §14.3. Every reason this deployment MUST refuse to delete `household`,
 * each named so the person can finish it and try again. An empty result is
 * not a promise that deleting will succeed for some other reason; it is the
 * whole of what this section asks to be checked.
 */
export function leaveBlockers(ctx: LeaveContext, household: string, now = Date.now()): Blocker[] {
  const { engine, recovery, mandates } = ctx;
  const blockers: Blocker[] = [];

  // "an offer of the household's at drafted, presented or decided, an
  // expired offer with a line that still owes a settlement, or an expired
  // physical box whose collection has not happened" — every offer this
  // household is the recipient of, whoever pays it, because the decision or
  // the signature it is waiting on is the household's own to give.
  const recipientOffers = engine.unionForHousehold(household, now);
  for (const offer of recipientOffers) {
    const collection = engine.recoveries.for(offer.id);
    if (moneyStillToMove(offer, collection)) {
      blockers.push({ kind: "offer_in_progress", id: offer.id });
    }
    const missing = collection?.missing ?? [];
    if (needsStatement(offer, missing) && !engine.settlement(offer.id)) {
      blockers.push({ kind: "statement_unsigned", id: offer.id });
    }
  }

  // "a reservation held on its ledger" — the household's own ledger, which is
  // reached only through an offer it pays for itself.
  for (const offer of ownOffers(recipientOffers, household)) {
    if (engine.reservationHeld(offer.id)) {
      blockers.push({ kind: "reservation_held", id: offer.id });
    }
  }

  // "a gift it pays for whose money has not finished moving (§12)".
  for (const id of engine.giftsInFlightBy(household, now)) {
    blockers.push({ kind: "gift_in_flight", id });
  }

  // "a pending mandate change, recovery request or permission request it
  // started". A permission action is opened on a request from a merchant, not
  // started by the household, and deletion removes it with the rest; counting
  // it let any merchant keep a household from ever leaving (refutation pass,
  // 2026-09-22, F3). A mandate change and a recovery request are one signed
  // write with nothing half-done between requests.

  // "a role it holds for another household: a co-signer on another
  // household's mandate (§16.1) or a recoverer of another household (clause
  // 53)". Named by the other household's mandate id, or its household id.
  for (const m of mandates.coSignerOn(household)) {
    blockers.push({ kind: "co_signer", id: m.id });
  }
  for (const other of recovery.recovererFor(household)) {
    blockers.push({ kind: "recoverer", id: other });
  }

  return blockers;
}

/**
 * §14.3. What a household signs to leave: the profile, the household and the
 * host it is leaving. The hub in front of the engine may hold the signature
 * instead and call the library, which is what the member API does; an
 * implementation reached over HTTP has nothing else to go on.
 */
export function canonicalLeave(household: string, relyingPartyId: string): Buffer {
  return Buffer.from(JSON.stringify(["valence.leave.1", household, relyingPartyId]));
}

/**
 * §14.3. Checks that the household itself asked. Throws `422 unsigned` when
 * nothing was sent or the household has no key here, and `422 bad_signature`
 * when what was sent does not cover this deletion at this host.
 */
export function checkLeaveSignature(ctx: LeaveContext, household: string, sent: { signature?: string; assertion?: Assertion }): void {
  const pem = ctx.engine.publicKeyFor(household);
  const one = sent.signature !== undefined, other = sent.assertion !== undefined;
  if (one && other) throw unprocessable("bad_signature", "a deletion carries a signature or an assertion, not both");
  if (!pem || (!one && !other)) throw unprocessable("unsigned", `deleting ${household} is signed by the household itself`);
  let ok = false;
  try {
    ok = verifyPersonal(canonicalLeave(household, ctx.engine.relyingPartyId), one ? { signature: sent.signature! } : { assertion: sent.assertion! }, pem, ctx.engine.relyingPartyId);
  } catch { ok = false; }
  if (!ok) throw unprocessable("bad_signature", `the signature does not cover deleting ${household} at this host`);
}

/**
 * §14.3. Deletes `household` from this host, or refuses and writes nothing.
 *
 * Refusing happens before anything is touched, so a refused call already
 * writes nothing on its own; the deletion itself runs inside one atomic
 * block (`common/store.ts`) so that a store which journals its writes rolls
 * every one of them back if any step throws, and a store with no journal at
 * all never gets partway through in the first place because every check
 * above has already passed.
 */
export function leaveHost(ctx: LeaveContext, household: string, now = Date.now()): { deleted: Record<string, number> } {
  const blockers = leaveBlockers(ctx, household, now);
  if (blockers.length > 0) {
    throw conflict(
      "leave_blocked",
      `${household} cannot leave while ${blockers.map((b) => `${b.kind} ${b.id}`).join(", ")} ${blockers.length === 1 ? "is" : "are"} unresolved`,
      // The refusal carries what blocked it, so a screen can name each one
      // without asking again and racing its own answer.
      { blockers }
    );
  }

  return atomically(() => {
    const { engine, recovery, permissions, mandates, deliveries, approvals, quotes } = ctx;
    const deleted: Record<string, number> = {};
    const bump = (key: string, n: number) => {
      if (n) deleted[key] = (deleted[key] ?? 0) + n;
    };
    const bumpBool = (key: string, had: boolean) => bump(key, had ? 1 : 0);

    // A household already deleted from this host, read before this one is
    // added to it: what decides whether a row this household shares with
    // another is still needed, or is the last row naming a key nobody who
    // holds it is left to ask for.
    // Only a household that has left and not come back: a departure row stays
    // seven years as audit and must not decide anything about a returned one.
    const isGone = (h: string) => engine.isDeparted(h);

    // Every offer naming this identifier, on either side, decided once so
    // that deletion and the identity sweep below agree on the same split.
    const all = engine.offersNaming(household);
    const own = ownOffers(all, household);
    const shared = all.filter((o) => !own.includes(o));
    // "What another household holds is not the leaving household's to
    // delete" (§14.3) holds only while that other household is still here to
    // hold it: the other party's own receipt and exploration floor (§5.1)
    // are what the offer is kept for, and neither survives that party. Once
    // it has already left, this row is the last thing naming it, and §14.3's
    // "removed with the last such row" is about exactly this offer.
    const orphaned = shared.filter((o) => isGone(o.household === household ? o.giver! : o.household));
    const kept = shared.filter((o) => !orphaned.includes(o));

    // §7.6b. A row kept for the other party still loses the lines this household wrote on it.
    for (const offer of kept) bump("notes", engine.deleteNotesBy(offer.id, household));

    for (const offer of [...own, ...orphaned]) {
      const counts = engine.deleteOfferRecord(offer.id);
      for (const [key, n] of Object.entries(counts)) bump(key, n);
      bumpBool("delivery", deliveries.deleteOffer(offer.id));
      bumpBool("carriage_quotes", quotes?.deleteOffer(offer.id) ?? false);
      bumpBool("deliberations", approvals.deleteOffer(offer.id));
    }

    // Every lineage edge is kept unless both ends are this household (a
    // self-edge, deleted outright), or its other end has already left, in
    // which case this is the same "last such row" case as an orphaned offer.
    const edges = engine.edgesTouching(household);
    const selfEdges = edges.filter((e) => e.from === household && e.to === household);
    const sharedEdges = edges.filter((e) => !selfEdges.includes(e));
    const orphanedEdges = sharedEdges.filter((e) => isGone(e.from === household ? e.to : e.from));
    const keptEdges = sharedEdges.filter((e) => !orphanedEdges.includes(e));
    for (const edge of [...selfEdges, ...orphanedEdges]) {
      bumpBool("edges", engine.deleteEdge(edge.id));
    }

    const rows = engine.deleteHouseholdOwnRows(household);
    bump("bare_receipts", rows.bare_receipts);
    bump("carried_payments", rows.carried_payments);
    bump("mandate_reads", rows.mandate_reads);

    const mandateCounts = mandates.deleteHousehold(household);
    bump("mandates", mandateCounts.mandates);
    bump("mandate_claims", mandateCounts.claims);

    const recoveryCounts = recovery.deleteHousehold(household);
    bump("recoverers", recoveryCounts.recoverers);
    bump("recovery_channels", recoveryCounts.channels);
    bump("recovery_log", recoveryCounts.log);

    const permissionCounts = permissions.deleteHousehold(household);
    bump("permissions", permissionCounts.permissions);
    bump("permission_queries", permissionCounts.queries);
    bump("permission_actions", permissionCounts.actions);

    // "retained exactly as long as a remaining household's edge or gift
    // needs it to verify, and removed with the last such row": this
    // household's own key first, since deleting `own` above may have just
    // made it the last such row.
    if (kept.length === 0 && keptEdges.length === 0) {
      const idRows = engine.deleteIdentity(household);
      bump("identities", idRows.identities);
      bump("root_endorsed", idRows.root_endorsed);
    }

    bumpBool("departed_households", engine.recordDeparture(household, now));

    // The sweep. Only a row deleted by this call can have been the last to name
    // an earlier departure's key, so only the other parties of those rows are
    // looked at, not every departure the host has had (F5).
    const candidates = new Set<string>();
    for (const o of orphaned) candidates.add(o.household === household ? o.giver! : o.household);
    for (const e of orphanedEdges) candidates.add(e.from === household ? e.to : e.from);
    const named = (h: string) => engine.offersNaming(h).length > 0 || engine.edgesTouching(h).length > 0;
    for (const other of candidates) {
      if (other === household || !isGone(other) || named(other)) continue;
      const idRows = engine.deleteIdentity(other);
      bump("identities", idRows.identities);
      bump("root_endorsed", idRows.root_endorsed);
    }

    // §14.3 keeps the audit fact seven years. A row older than that goes once
    // nothing names the household; a row still named stays, because it is what
    // tells a later departure that the other party has left.
    for (const d of engine.departures()) {
      if (d.household === household || !isGone(d.household) || d.left_at > now - SEVEN_YEARS_MS || named(d.household)) continue;
      bumpBool("departed_households_expired", engine.forgetDeparture(d.household));
    }

    return { deleted };
  });
}
