import { describe, expect, test } from "bun:test";
import { sign } from "node:crypto";
import { inMemoryStore } from "../src/common/store.js";
import { ValenceError } from "../src/common/errors.js";
import { RecoveryRegister, exportNode } from "../src/hub/node.js";
import { PermissionLedger } from "../src/hub/permissions.js";
import { ApprovalDesk } from "../src/hub/approval.js";
import { CarriageQuotes } from "../src/hub/carriage-quote.js";
import { canonicalMandate, type Mandate } from "../src/hub/mandates.js";
import { canonicalDecisions } from "../src/shared/decisions.js";
import { canonicalStatement, statementLines } from "../src/shared/statement.js";
import { leaveBlockers, leaveHost, type LeaveContext } from "../src/hub/leave.js";
import type { ValenceEngine } from "../src/engine/offers.js";
import type { DeliveryRegister } from "../src/hub/delivery.js";
import { CONFIG_VERSION, HOUR, houseFor, makeEngine, presentGift } from "./helpers.js";

/**
 * §14.3, decided by the founder on 2026-09-22. Everything here goes through
 * the real engine and the real hub registers, on the same store, exactly as
 * `createApp`'s composition root wires them (`http.ts` ~line 1431), because
 * `leave.ts` deletes across all of them and a fixture that mocked one would
 * not prove the boundary between them holds.
 */

const RP = "unit.example";
const DAY = 86_400_000;

function setup(): LeaveContext {
  const store = inMemoryStore();
  const { engine, deliveries } = makeEngine({}, store);
  return {
    engine,
    recovery: new RecoveryRegister(store),
    permissions: new PermissionLedger(store),
    mandates: engine.mandates,
    deliveries,
    approvals: new ApprovalDesk(store),
    quotes: new CarriageQuotes(store),
  };
}

type House = ReturnType<typeof houseFor>;

const pair = (a: string, b: string) => [
  { product: a, quantity: 1, predicted_conversion: 0.5, is_exploration: false, given_by: null },
  { product: b, quantity: 1, predicted_conversion: 0.05, is_exploration: true, given_by: null },
];

function draftDigital(engine: ValenceEngine, h: House, now: number, products: [string, string] = ["tea-a", "tea-b"]) {
  return engine.createOffer({
    binding: "digital", household: h.household, purpose: "replenish", config_version: CONFIG_VERSION,
    expires_at: now + HOUR, mandate: `${h.household}.1`, price_band: null, giver: null,
    candidates: pair(...products),
  } as never);
}

async function settleDigital(engine: ValenceEngine, h: House, offerId: string, now: number) {
  const offer = engine.mustGet(offerId, now);
  const decisions = [
    { candidate: offer.candidates[0]!.id, valence: "kept" as const, kept_as: "self" as const },
    { candidate: offer.candidates[1]!.id, valence: "returned" as const },
  ];
  const signature = sign(null, canonicalDecisions(offerId, decisions), h.privateKey).toString("base64");
  await engine.decide(offerId, decisions, signature, now);
  await engine.settle(offerId, now);
}

function draftPhysical(engine: ValenceEngine, h: House, now: number, products: [string, string] = ["coffee-a", "miso-a"]) {
  return engine.createOffer({
    binding: "physical", household: h.household, purpose: "replenish", config_version: CONFIG_VERSION,
    expires_at: now + HOUR, mandate: `${h.household}.1`, price_band: null, giver: null,
    candidates: pair(...products),
  } as never);
}

/** Collects everything as consumed, so the box owes a settlement and needs the household's statement (§6.5). */
async function collectConsumed(engine: ValenceEngine, deliveries: DeliveryRegister, offerId: string, now: number) {
  deliveries.record({ offer: offerId, carriage: 100, code: "dc", status: "delivered" });
  const offer = engine.mustGet(offerId, now);
  await engine.collect({ offer: offerId, returned: [], consumed: offer.candidates.map((c) => c.id), at: now });
  engine.applyRecoveryTo(offerId, now);
}

async function settlePhysical(engine: ValenceEngine, deliveries: DeliveryRegister, h: House, offerId: string, now: number) {
  await collectConsumed(engine, deliveries, offerId, now);
  const missing = engine.recoveries.for(offerId)?.missing ?? [];
  const lines = statementLines(engine.mustGet(offerId, now), [], missing);
  const carried = await engine.deliveryFor(offerId);
  const signature = sign(null, canonicalStatement(offerId, carried ? carried.carriage : 0, lines), h.privateKey).toString("base64");
  await engine.settle(offerId, now, { signed: { signature }, disputed: [] });
}

const mandateFor = (h: House, coSigners: string[], now: number, over: Partial<Mandate> = {}): Mandate => ({
  id: `${h.household}.1`, household: h.household, ceiling_out_of_network: 0, ceiling_daily: null,
  cooling_seconds: null, co_signers: coSigners, lapses_at: now + 300 * DAY, version: 1, ...over,
});

function recordMandate(engine: ValenceEngine, h: House, m: Mandate, now: number) {
  const bytes = canonicalMandate(m, RP);
  return engine.mandates.record({
    mandate: m,
    signatures: { [h.household]: sign(null, bytes, h.privateKey).toString("base64") },
    assertions: {},
    keyOf: (k: string) => engine.publicKeyFor(k),
    relyingPartyId: RP,
    now,
  });
}

function nameRecoverer(recovery: RecoveryRegister, of_: House, as_: House) {
  recovery.nameRecoverers(of_.household, [as_.household]);
  recovery.registerChannels(of_.household, [{ channel: `email://${of_.household}`, controlled_by_recoverer: false }]);
}

function addEdge(engine: ValenceEngine, from: House, to: House, now: number) {
  const input = {
    from: from.household, to: to.household, product: "tea-a", merchant: "merchant-1",
    maker: "made-by-tea", kind: "gift" as const, occasion: "birth", receipt: `r-${from.household}-${to.household}`,
  };
  return engine.acceptEdge({ ...input, signature: from.signEdge(input), now });
}

/** §12. A ceremonial offer, presented on the giver's signature. Mirrors "a ceremonial offer ships exactly one default" in engine.test.ts. */
async function ceremonial(engine: ValenceEngine, giver: House, recipient: House, now: number) {
  const offer = engine.createOffer({
    binding: "digital", household: recipient.household, purpose: "ceremonial", config_version: CONFIG_VERSION,
    expires_at: now + 1000, mandate: `${recipient.household}.1`, price_band: { min: 0, max: 100_000 },
    giver: giver.household,
    candidates: [
      { product: "tea-a", quantity: 1, predicted_conversion: 0.5, is_exploration: false, given_by: null },
      { product: "nori-a", quantity: 1, predicted_conversion: 0.5, is_exploration: false, given_by: null },
      { product: "miso-a", quantity: 1, predicted_conversion: 0.05, is_exploration: true, given_by: null },
    ],
  } as never);
  await presentGift(engine, offer.id, now, giver);
  return offer;
}

const refuses = (f: () => unknown): string | undefined => {
  try {
    f();
    return undefined;
  } catch (err) {
    return (err as ValenceError).code;
  }
};

describe("§14.3 leaveBlockers: each reason is refused, named, and writes nothing", () => {
  test("offer_in_progress: an offer still presented refuses", async () => {
    const ctx = setup();
    const h = houseFor("blk-progress");
    ctx.engine.registerIdentity(h.household, h.pem);
    const now = Date.now();
    const offer = draftDigital(ctx.engine, h, now);
    await ctx.engine.present(offer.id, now);
    const before = structuredClone(ctx.engine.mustGet(offer.id, now));

    expect(leaveBlockers(ctx, h.household, now)).toContainEqual({ kind: "offer_in_progress", id: offer.id });
    expect(refuses(() => leaveHost(ctx, h.household, now))).toBe("leave_blocked");

    expect(ctx.engine.mustGet(offer.id, now)).toEqual(before);
    expect(ctx.engine.departures()).toEqual([]);
  });

  test("statement_unsigned: a collected physical box awaiting the household's signature refuses", async () => {
    const ctx = setup();
    const h = houseFor("blk-statement");
    ctx.engine.registerIdentity(h.household, h.pem);
    const now = Date.now();
    const offer = draftPhysical(ctx.engine, h, now);
    await ctx.engine.present(offer.id, now);
    await collectConsumed(ctx.engine, ctx.deliveries, offer.id, now);

    expect(leaveBlockers(ctx, h.household, now)).toContainEqual({ kind: "statement_unsigned", id: offer.id });
    expect(refuses(() => leaveHost(ctx, h.household, now))).toBe("leave_blocked");

    expect(ctx.engine.settlement(offer.id)).toBeUndefined();
    expect(ctx.engine.departures()).toEqual([]);
  });

  test("reservation_held: a presented offer's own reserve refuses", async () => {
    const ctx = setup();
    const h = houseFor("blk-reservation");
    ctx.engine.registerIdentity(h.household, h.pem);
    const now = Date.now();
    const offer = draftDigital(ctx.engine, h, now);
    await ctx.engine.present(offer.id, now);

    expect(ctx.engine.reservationHeld(offer.id)).toBe(true);
    expect(leaveBlockers(ctx, h.household, now)).toContainEqual({ kind: "reservation_held", id: offer.id });
    expect(refuses(() => leaveHost(ctx, h.household, now))).toBe("leave_blocked");

    expect(ctx.engine.reservationHeld(offer.id)).toBe(true);
    expect(ctx.engine.departures()).toEqual([]);
  });

  test("gift_in_flight: an undecided gift the household pays for refuses", async () => {
    const ctx = setup();
    const giver = houseFor("blk-giver");
    const recipient = houseFor("blk-recipient");
    ctx.engine.registerIdentity(recipient.household, recipient.pem);
    const now = Date.now();
    const offer = await ceremonial(ctx.engine, giver, recipient, now);

    expect(leaveBlockers(ctx, giver.household, now)).toContainEqual({ kind: "gift_in_flight", id: offer.id });
    expect(refuses(() => leaveHost(ctx, giver.household, now))).toBe("leave_blocked");

    expect(ctx.engine.giftsInFlightBy(giver.household, now)).toEqual([offer.id]);
    expect(ctx.engine.departures()).toEqual([]);
  });

  test("permission_action_pending: a still-live action refuses", () => {
    const ctx = setup();
    const h = houseFor("blk-action");
    ctx.engine.registerIdentity(h.household, h.pem);
    const now = Date.now();
    const action = ctx.permissions.openAction({ household: h.household, describes: "share basket contents", expiresAt: now + HOUR });

    expect(leaveBlockers(ctx, h.household, now)).toContainEqual({ kind: "permission_action_pending", id: action.id });
    expect(refuses(() => leaveHost(ctx, h.household, now))).toBe("leave_blocked");

    expect(ctx.permissions.pendingActionsFor(h.household, now).map((a) => a.id)).toEqual([action.id]);
    expect(ctx.engine.departures()).toEqual([]);
  });

  test("co_signer: a role held on another household's mandate refuses", () => {
    const ctx = setup();
    const owner = houseFor("blk-mandate-owner");
    const cosigner = houseFor("blk-mandate-cosigner");
    ctx.engine.registerIdentity(owner.household, owner.pem);
    ctx.engine.registerIdentity(cosigner.household, cosigner.pem);
    const now = Date.now();
    recordMandate(ctx.engine, owner, mandateFor(owner, [cosigner.household], now), now);

    expect(leaveBlockers(ctx, cosigner.household, now)).toContainEqual({ kind: "co_signer", id: `${owner.household}.1` });
    expect(refuses(() => leaveHost(ctx, cosigner.household, now))).toBe("leave_blocked");

    expect(ctx.engine.mandates.get(`${owner.household}.1`)?.co_signers).toEqual([cosigner.household]);
    expect(ctx.engine.departures()).toEqual([]);
  });

  test("recoverer: a role held for another household refuses", () => {
    const ctx = setup();
    const owner = houseFor("blk-recovery-owner");
    const recoverer = houseFor("blk-recovery-agent");
    ctx.engine.registerIdentity(owner.household, owner.pem);
    ctx.engine.registerIdentity(recoverer.household, recoverer.pem);
    const now = Date.now();
    nameRecoverer(ctx.recovery, owner, recoverer);

    expect(leaveBlockers(ctx, recoverer.household, now)).toContainEqual({ kind: "recoverer", id: owner.household });
    expect(refuses(() => leaveHost(ctx, recoverer.household, now))).toBe("leave_blocked");

    expect(ctx.recovery.recoverersFor(owner.household)).toEqual([recoverer.household]);
    expect(ctx.engine.departures()).toEqual([]);
  });
});

describe("§14.3 leaveHost: a household with a full record", () => {
  test("settled digital and physical offers, a note, a permission, a mandate and a recovery config are all deleted, and a repeat call is a no-op", async () => {
    const ctx = setup();
    const h = houseFor("full-record");
    ctx.engine.registerIdentity(h.household, h.pem);
    const now = Date.now();

    const digital = draftDigital(ctx.engine, h, now);
    await ctx.engine.present(digital.id, now);
    await settleDigital(ctx.engine, h, digital.id, now);

    const physical = draftPhysical(ctx.engine, h, now);
    await ctx.engine.present(physical.id, now);
    await settlePhysical(ctx.engine, ctx.deliveries, h, physical.id, now);
    ctx.engine.addNote({ candidate: physical.candidates[0]!.id, author: h.household, text: "good tea", shared_with: [], now });

    // §37. The action lapses on its own before the household leaves, so it is
    // not itself a blocker, and it is still one of the rows deleted with it.
    const action = ctx.permissions.openAction({ household: h.household, describes: "share basket", expiresAt: now + 1000 });
    ctx.permissions.grant({
      household: h.household, grantee: "some-app", scope: ["basket"], purpose: "recommend",
      expires_at: now + DAY, asked_from: action.id, now,
    });

    recordMandate(ctx.engine, h, mandateFor(h, [], now), now);
    nameRecoverer(ctx.recovery, h, houseFor("full-record-recoverer"));

    const leaveNow = now + 2000; // past the permission action's own expiry
    expect(leaveBlockers(ctx, h.household, leaveNow)).toEqual([]);

    const { deleted } = leaveHost(ctx, h.household, leaveNow);
    expect(deleted.offers).toBe(2);
    expect(deleted.notes).toBe(1);
    expect(deleted.mandates).toBe(1);
    expect(deleted.permissions).toBe(1);
    expect(deleted.permission_actions).toBe(1);
    expect(deleted.recoverers).toBe(1);
    expect(deleted.identities).toBe(1);
    expect(deleted.departed_households).toBe(1);

    expect(ctx.engine.unionForHousehold(h.household, leaveNow)).toEqual([]);
    expect(ctx.engine.mandates.forHousehold(h.household)).toEqual([]);
    expect(ctx.permissions.forHousehold(h.household)).toEqual([]);
    expect(ctx.permissions.pendingActionsFor(h.household, leaveNow)).toEqual([]);
    expect(ctx.recovery.recoverersFor(h.household)).toEqual([]);
    expect(ctx.engine.publicKeyFor(h.household)).toBeUndefined();
    expect(ctx.engine.departures()).toEqual([{ household: h.household, left_at: leaveNow }]);

    const exported = exportNode(ctx.engine, ctx.recovery, ctx.permissions, ctx.engine.mandates, ctx.deliveries, h.household, leaveNow, ctx.quotes);
    expect(exported.offers).toEqual([]);
    expect(exported.settlements).toEqual([]);
    expect(exported.notes).toEqual([]);
    expect(exported.mandates).toEqual([]);
    expect(exported.permissions).toEqual([]);
    expect(exported.queries).toEqual([]);
    expect(exported.recoveries).toEqual([]);
    expect(exported.collections).toEqual([]);

    // A second call for the same, now-departed household deletes nothing
    // further, moves nothing, and does not throw.
    const second = leaveHost(ctx, h.household, leaveNow + DAY);
    expect(second.deleted).toEqual({});
    expect(ctx.engine.departures()).toEqual([{ household: h.household, left_at: leaveNow }]);
  });
});

describe("§14.3: a gift between two households", () => {
  test("keeps the other household's copy and its key while it is here, and sweeps the departed party's key once nothing remains", async () => {
    const ctx = setup();
    const giver = houseFor("gift-giver-full");
    const recipient = houseFor("gift-recipient-full");
    ctx.engine.registerIdentity(giver.household, giver.pem);
    ctx.engine.registerIdentity(recipient.household, recipient.pem);
    const now = Date.now();

    const offer = await ceremonial(ctx.engine, giver, recipient, now);
    await ctx.engine.settle(offer.id, now + 2000);
    const edge = addEdge(ctx.engine, giver, recipient, now);

    // The giver leaves first. Nothing of its own to delete: the offer and
    // the edge are the recipient's record as much as the giver's.
    const leaveGiver = now + 2000;
    expect(leaveBlockers(ctx, giver.household, leaveGiver)).toEqual([]);
    const first = leaveHost(ctx, giver.household, leaveGiver);
    expect(first.deleted.offers ?? 0).toBe(0);
    expect(first.deleted.edges ?? 0).toBe(0);
    expect(first.deleted.identities ?? 0).toBe(0);

    // §14.3: "a gift the household gave or received stays in the other
    // household's records unchanged, with its lineage edge".
    expect(ctx.engine.settlement(offer.id)).toBeDefined();
    expect(ctx.engine.unionForHousehold(recipient.household, leaveGiver).map((o) => o.id)).toEqual([offer.id]);
    expect(ctx.engine.edgesTouching(recipient.household).map((e) => e.id)).toEqual([edge.id]);
    // "retained exactly as long as a remaining household's edge or gift
    // needs it to verify".
    expect(ctx.engine.publicKeyFor(giver.household)).toBe(giver.pem);
    expect(ctx.engine.departures()).toEqual([{ household: giver.household, left_at: leaveGiver }]);

    // The recipient leaves too. Now nothing at this host needs the giver's
    // copy or its key either, so both go: "removed with the last such row".
    const leaveRecipient = now + 3000;
    expect(leaveBlockers(ctx, recipient.household, leaveRecipient)).toEqual([]);
    const second = leaveHost(ctx, recipient.household, leaveRecipient);
    expect(second.deleted.offers).toBe(1);
    expect(second.deleted.edges).toBe(1);
    expect(second.deleted.identities).toBe(2); // the recipient's own, and the giver's swept

    expect(ctx.engine.settlement(offer.id)).toBeUndefined();
    expect(ctx.engine.edgesTouching(giver.household)).toEqual([]);
    expect(ctx.engine.edgesTouching(recipient.household)).toEqual([]);
    expect(ctx.engine.publicKeyFor(giver.household)).toBeUndefined();
    expect(ctx.engine.publicKeyFor(recipient.household)).toBeUndefined();
  });
});

describe("§14.3: no collateral damage", () => {
  test("deleting one household does not touch any row of an unrelated household", async () => {
    const ctx = setup();
    const a = houseFor("collateral-a");
    const c = houseFor("collateral-c");
    ctx.engine.registerIdentity(a.household, a.pem);
    ctx.engine.registerIdentity(c.household, c.pem);
    const now = Date.now();

    const aOffer = draftDigital(ctx.engine, a, now);
    await ctx.engine.present(aOffer.id, now);
    await settleDigital(ctx.engine, a, aOffer.id, now);

    const cOffer = draftDigital(ctx.engine, c, now);
    await ctx.engine.present(cOffer.id, now);
    await settleDigital(ctx.engine, c, cOffer.id, now);
    ctx.engine.addNote({ candidate: cOffer.candidates[0]!.id, author: c.household, text: "kept for c", shared_with: [], now });
    recordMandate(ctx.engine, c, mandateFor(c, [], now), now);
    nameRecoverer(ctx.recovery, c, houseFor("collateral-c-recoverer"));
    const cAction = ctx.permissions.openAction({ household: c.household, describes: "x", expiresAt: now + 500 });
    ctx.permissions.grant({ household: c.household, grantee: "app", scope: ["s"], purpose: "p", expires_at: now + DAY, asked_from: cAction.id, now });

    const snapshotAt = now + 10_000;
    const before = exportNode(ctx.engine, ctx.recovery, ctx.permissions, ctx.engine.mandates, ctx.deliveries, c.household, snapshotAt, ctx.quotes);

    expect(leaveBlockers(ctx, a.household, snapshotAt)).toEqual([]);
    leaveHost(ctx, a.household, snapshotAt);

    const after = exportNode(ctx.engine, ctx.recovery, ctx.permissions, ctx.engine.mandates, ctx.deliveries, c.household, snapshotAt, ctx.quotes);
    expect(after).toEqual(before);
    expect(ctx.engine.departures()).toEqual([{ household: a.household, left_at: snapshotAt }]);
  });
});

describe("§14.3: idempotent departure", () => {
  test("a second call for an already-departed household deletes nothing further and does not throw", () => {
    const ctx = setup();
    const h = houseFor("idempotent-leave");
    ctx.engine.registerIdentity(h.household, h.pem);
    const now = Date.now();

    const first = leaveHost(ctx, h.household, now);
    expect(first.deleted.identities).toBe(1);
    expect(ctx.engine.departures()).toEqual([{ household: h.household, left_at: now }]);

    const second = leaveHost(ctx, h.household, now + 60_000);
    expect(second.deleted).toEqual({});
    expect(ctx.engine.departures()).toEqual([{ household: h.household, left_at: now }]);
    expect(leaveBlockers(ctx, h.household, now + 60_000)).toEqual([]);
  });
});
