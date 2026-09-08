import { createHash, randomUUID } from "node:crypto";
import type { ValenceEngine } from "./engine.js";
import type { LineageEdge, Note, Offer, Settlement } from "./types.js";

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
export const EXPORT_FORMAT_VERSION = "valence-node/1";

export type NodeExport = {
  format: string;
  household: string;
  exported_at: number;
  /** Every offer placed with this household, whatever its state. */
  offers: Offer[];
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
  private readonly recoverers = new Map<string, string[]>();
  private readonly channels = new Map<
    string,
    { channel: string; controlled_by_recoverer: boolean }[]
  >();
  private readonly log = new Map<string, RecoveryRecord[]>();

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
  household: string,
  now = Date.now()
): NodeExport {
  const offers = engine.unionForHousehold(household, now);
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
