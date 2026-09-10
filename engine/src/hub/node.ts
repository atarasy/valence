import { inMemoryStore, type Store } from "../common/store.js";
import { createHash, randomUUID } from "node:crypto";
import type { ValenceEngine } from "../engine/offers.js";
import type { LineageEdge, Note, Offer, Settlement, PresenterConfig, Recovery } from "../common/types.js";
import type { Permission, Query, PermissionLedger } from "./permissions.js";
import type { Mandate, MandateRegister } from "./mandates.js";
import type { Delivery, DeliveryRegister } from "./delivery.js";

/**
 * A household's node, and what leaves with it.
 *
 * Clause 43 asks that data be held in a form the customer can export in full.
 * Clause 52 asks that a member be able to move an entire node to another host,
 * and that the host be replaceable and blind.
 *
 * **An export is correct when the second host answers the same questions the
 * same way, not when a file with the right field names is produced.** Defining
 * it by a field list means a surface added later can be missing from the export
 * while the export still passes, so the conformance probes compare answers
 * rather than schemas.
 *
 * The other rule this file exists to keep: **what a surface does not hold, the
 * export still holds.** The giver's surface carries no list of gifts sent, and
 * the export carries it. Otherwise a member who changes hosts loses their own
 * record of what they gave.
 */
/**
 * Bumped to /2 on 2026-09-09, when the permission ledger, the mandates and the
 * queries joined the export. A host on /1 has no field for them, and the
 * project's own rule is that an unknown field is refused rather than dropped
 * (`common/validate.ts`). A silent drop here is worse than a refused move: the
 * member arrives at the new host apparently intact and without their
 * protections.
 */
export const EXPORT_FORMAT_VERSION = "valence-node/3";

export type NodeExport = {
  format: string;
  household: string;
  exported_at: number;
  /** Every offer placed with this household, whatever its state. */
  offers: Offer[];
  /**
   * §10.5. What has already confirmed each of those offers. Without it a move
   * resets the one-use rule: measured 2026-09-11, an offer withdrawn on one
   * host was put back on a second with the assertion captured on the first.
   * The format's version says so, because a receiving host that does not know
   * this field would drop it.
   */
  confirmations: Record<string, string[]>;
  settlements: Settlement[];
  notes: Note[];
  /**
   * Both directions. The outgoing edges are the list the giver's surface
   * declines to show, and they are this household's own record.
   */
  lineage: LineageEdge[];
  receipts: { ref: string; at: number }[];
  /** Clause 53. Recovery is logged, and the log leaves with the node. */
  recoveries: RecoveryRecord[];
  /** Clause 43. Every permission the person granted, revoked rows included. */
  permissions: Permission[];
  /** Clause 20. The duplicate checks written into the recipient's record. */
  queries: Query[];
  /** Clauses 46, 47, 52, 58. The person's standing protections. */
  mandates: Mandate[];
  /** §7.5b. Carriage and where each parcel is. The person's side of clause 49. */
  deliveries: Delivery[];
};

export type RecoveryRecord = {
  id: string;
  household: string;
  initiated_by: string;
  at: number;
  /** The channels the notice went to, and whether each is the recoverer's. */
  notified: { channel: string; controlled_by_recoverer: boolean }[];
};

/**
 * Recovery restores access and never returns content (clause 53).
 *
 * The two powers are separate here in the only way a schema can make them
 * separate: a recoverer is named in this register and nowhere else, and
 * nothing consults this register when deciding what may be read.
 */
export class RecoveryRegister {
  private readonly recoverers: Map<string, string[]>;
  private readonly channels: Map<
    string,
    { channel: string; controlled_by_recoverer: boolean }[]
  >;
  private readonly log: Map<string, RecoveryRecord[]>;

  /** §13.2. Where this register keeps what it holds. Unset is in memory. */
  constructor(store: Store = inMemoryStore()) {
    this.recoverers = store.map("recoverers");
    this.channels = store.map("recovery_channels");
    this.log = store.map("recovery_log");
  }

  nameRecoverers(household: string, keys: string[]): void {
    this.recoverers.set(household, [...keys]);
  }

  registerChannels(
    household: string,
    channels: { channel: string; controlled_by_recoverer: boolean }[]
  ): void {
    if (!channels.some((c) => !c.controlled_by_recoverer)) {
      // A recoverer who holds every channel can recover in silence, and
      // clause 53's requirement to notify the person becomes decorative.
      throw new Error(
        "at least one notification channel must be outside the recoverer's control"
      );
    }
    this.channels.set(household, [...channels]);
  }

  recoverersFor(household: string): string[] {
    return this.recoverers.get(household) ?? [];
  }

  /**
   * Records the recovery and returns what was notified.
   *
   * The log is written before access is restored rather than after, so that a
   * recoverer cannot complete one and then suppress the record.
   */
  recover(input: { household: string; by: string; now?: number }): RecoveryRecord {
    const recoverers = this.recoverers.get(input.household) ?? [];
    if (!recoverers.includes(input.by)) {
      throw new Error(`${input.by} is not a recoverer for this household`);
    }
    const channels = this.channels.get(input.household) ?? [];
    if (!channels.some((c) => !c.controlled_by_recoverer)) {
      throw new Error("no channel outside the recoverer's control");
    }
    const record: RecoveryRecord = {
      id: randomUUID(),
      household: input.household,
      initiated_by: input.by,
      at: input.now ?? Date.now(),
      notified: channels,
    };
    const rows = this.log.get(input.household) ?? [];
    rows.push(record);
    this.log.set(input.household, rows);
    return record;
  }

  /** Clause 53: the log leaves with the node, so it must also arrive with it. */
  importLog(household: string, records: RecoveryRecord[]): void {
    if (records.length) this.log.set(household, [...records]);
  }

  logFor(household: string): RecoveryRecord[] {
    return this.log.get(household) ?? [];
  }
}

/**
 * Everything the household holds, gathered for a move.
 *
 * This reads the engine rather than the surfaces, which is the point of §7.2 of
 * the hub-surfaces specification: the surfaces withhold, the export does not.
 */
export function exportNode(
  engine: ValenceEngine,
  recovery: RecoveryRegister,
  permissions: PermissionLedger,
  mandates: MandateRegister,
  deliveries: DeliveryRegister,
  household: string,
  now = Date.now()
): NodeExport {
  // Clause 43, §13.2. The person's own copy first: on a deployment presenting
  // the hub alone there is no engine store to read, and an export built from
  // one would come back empty. Where both roles run in one process the two
  // agree, and the engine's is used because it is the live state.
  const recorded = engine.householdLedger.offersFor(household);
  const live = engine.unionForHousehold(household, now);
  const offers = live.length > 0 ? live : (recorded.map((r) => r.offer) as typeof live);
  const settlements = offers
    .map((o) => engine.settlement(o.id))
    .filter((s): s is Settlement => s !== undefined);
  const notes = offers.flatMap((o) =>
    o.candidates.flatMap((c) => engine.notesFor(c.id))
  );
  return {
    format: EXPORT_FORMAT_VERSION,
    household,
    exported_at: now,
    offers,
    settlements,
    notes,
    lineage: engine.edgesTouching(household),
    receipts: engine.receiptsFor(household),
    recoveries: recovery.logFor(household),
    confirmations: engine.confirmationsFor(offers.map((o) => o.id)),
    ...permissions.exportFor(household),
    mandates: mandates.forHousehold(household),
    deliveries: deliveries.forHousehold(offers.map((o) => o.id)),
  };
}

/**
 * A stable digest of what a node holds, ignoring when it was exported.
 *
 * Two hosts serving the same node produce the same digest. It is a shortcut
 * for the probes and not a substitute for them: a digest that matches says the
 * content moved, and only asking each surface says the answers did.
 */
export function digest(node: NodeExport): string {
  const stable = {
    format: node.format,
    household: node.household,
    offers: node.offers,
    settlements: node.settlements,
    notes: node.notes,
    lineage: node.lineage,
    receipts: node.receipts,
    recoveries: node.recoveries,
  };
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

/**
 * Clauses 5 and 43. What a shop leaves with.
 *
 * A shop's ledgers are the shop's: every catalogue version it registered,
 * every offer it made and how each settled, the recovery rows of its own
 * physical offers, and the lines households chose to share with it. Nothing
 * of another presenter's, and nothing of a household's beyond what this
 * presenter already holds, which is its own vertical view (clause 8).
 *
 * There is no import beside it. Where a shop goes with its ledgers is the
 * receiving platform's business; what this specification owes the shop is
 * that leaving is possible and complete.
 */
export const MERCHANT_EXPORT_FORMAT_VERSION = "valence-merchant/1";

export type MerchantExport = {
  format: string;
  presenter: string;
  exported_at: number;
  configs: PresenterConfig[];
  offers: Offer[];
  settlements: Settlement[];
  /** Only the lines a household shared with the merchant (clause 27). */
  notes: Note[];
  recoveries: Recovery[];
};

export function exportMerchant(
  engine: ValenceEngine,
  presenter: string,
  now = Date.now()
): MerchantExport {
  const offers = engine.offersForPresenter(presenter, now);
  const settlements = offers
    .map((o) => engine.settlement(o.id))
    .filter((s): s is Settlement => s !== undefined);
  const notes = offers.flatMap((o) =>
    o.candidates.flatMap((c) => engine.notesSharedWith(c.id, "merchant"))
  );
  const recoveries = offers
    .map((o) => engine.recoveries.for(o.id))
    .filter((r): r is Recovery => r !== undefined);
  return {
    format: MERCHANT_EXPORT_FORMAT_VERSION,
    presenter,
    exported_at: now,
    configs: engine.configsForPresenter(presenter),
    offers,
    settlements,
    notes,
    recoveries,
  };
}
