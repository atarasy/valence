import { describe, expect, test } from "bun:test";
import { inMemoryStore } from "../src/common/store.js";
import { ValenceEngine } from "../src/engine/offers.js";
import { InMemoryLedger } from "../src/engine/ledger.js";
import { createApp } from "../src/http.js";
import { ApprovalDesk } from "../src/hub/approval.js";
import { DeliveryRegister } from "../src/hub/delivery.js";
import { RecoveryRegister } from "../src/hub/node.js";
import { PermissionLedger } from "../src/hub/permissions.js";
import { Registry } from "../src/shared/registry.js";
import { signer } from "./helpers.js";

/**
 * §14.2, question 52, decided 2026-09-15. An import writes only rows that name
 * the household on its path or an offer it carries, and adds to what the host
 * holds without replacing it. Only offers and edges were bound before, and a
 * refutation pass measured an import under one household replacing another's
 * mandate: ceiling raised, co-signers emptied, cooling window gone.
 */
function host() {
  const store = inMemoryStore();
  const engine = new ValenceEngine(new InMemoryLedger(), {
    explorationRate: 0.2, reminderLimit: 1, recoveryGraceDays: 3, relyingPartyId: "unit.example",
  }, store);
  const deliveries = new DeliveryRegister(store);
  const recovery = new RecoveryRegister(store);
  const permissions = new PermissionLedger(store);
  const handle = createApp(engine, { deliveries, approvals: new ApprovalDesk(store), recovery, permissions, registry: new Registry(store) });
  const post = async (household: string, body: Record<string, unknown>) =>
    handle(new Request(`https://unit.example/households/${household}/import`, {
      method: "POST", body: JSON.stringify({ format: "valence-node/6", ...body }),
    }));
  return { engine, deliveries, recovery, permissions, post };
}

const mandate = (household: string, over: Record<string, unknown> = {}) => ({
  id: "m-victim", household, ceiling_out_of_network: 1000, co_signers: ["cs"], ceiling_daily: null,
  cooling_seconds: 3600, lapses_at: 9e15, version: 3, ...over,
});
const offer = (id: string, household: string) => ({ id, household, candidates: [{ id: `${id}-c` }] });
const collection = (id: string) => ({ offer: id, due_at: 1, grace_days: 3, collected_at: null, returned: [], consumed: [], missing: [], missing_notes: {} });

describe("§14.2: an import writes only its own household's rows", () => {
  test("another household's mandate is refused and left as it was", async () => {
    // NOTE (mutation check, 2026-09-15): import_mandate_any_household. The
    // import answered 201 and the victim's mandate read an empty co-signer list.
    const h = host();
    expect((await h.post("victim", { mandates: [mandate("victim")] })).status).toBe(201);
    const r = await h.post("attacker", { mandates: [mandate("victim", { ceiling_out_of_network: 1e12, co_signers: [], cooling_seconds: null, version: 1 })] });
    expect(r.status).toBe(422);
    expect(h.engine.mandates.get("m-victim")).toMatchObject({ ceiling_out_of_network: 1000, co_signers: ["cs"], cooling_seconds: 3600, version: 3 });
  });

  test("a mandate this host already holds is not replaced, even by its own household", async () => {
    // NOTE (mutation check, 2026-09-15): import_mandate_replaces_held. The
    // looser version was written and the co-signers were gone.
    //
    // A version this host already has the equal of is kept as it is; a later
    // version is refused outright, because loosening needs the co-signers
    // (§16.1) and a move carries no signatures.
    const h = host();
    expect((await h.post("victim", { mandates: [mandate("victim")] })).status).toBe(201);
    const same = await h.post("victim", { mandates: [mandate("victim", { co_signers: [] })] });
    expect(same.status).toBe(201);
    expect(h.engine.mandates.get("m-victim")?.co_signers).toEqual(["cs"]);
    // A later version that gives the household less is kept out without a
    // refusal, because refusing would let a mandate that arrived first block
    // the household's move. A later version that gives it more is taken.
    const looser = await h.post("victim", { mandates: [mandate("victim", { co_signers: [], version: 4 })] });
    expect(looser.status).toBe(201);
    expect(h.engine.mandates.get("m-victim")).toMatchObject({ co_signers: ["cs"], version: 3 });
    const tighter = await h.post("victim", { mandates: [mandate("victim", { co_signers: ["cs", "cs2"], ceiling_out_of_network: 500, version: 4 })] });
    expect(tighter.status).toBe(201);
    expect(h.engine.mandates.get("m-victim")).toMatchObject({ co_signers: ["cs", "cs2"], ceiling_out_of_network: 500, version: 4 });
  });

  test("a settlement, a note, a collection and a delivery must name an offer the import carries", async () => {
    // NOTE (mutation check, 2026-09-15): import_settlement_unscoped,
    // import_note_unscoped, import_collection_unscoped and
    // import_delivery_unscoped each let their row through. Each case below
    // failed with 201 under its own mutation.
    const h = host();
    expect((await h.post("victim", { offers: [offer("o-v", "victim")] })).status).toBe(201);
    const cases: [string, Record<string, unknown>][] = [
      ["settlement", { settlements: [{ offer: "o-v", settled_at: 1, kept_amount: 0, consumed_amount: 0 }] }],
      ["note", { notes: [{ candidate: "o-v-c", author: "a", text: "t", shared_with: [], created_at: 1 }] }],
      ["collection", { collections: [collection("o-v")] }],
      ["delivery", { deliveries: [{ offer: "o-v", carriage: 1, code: "c", status: "placed", updated_at: 1 }] }],
    ];
    for (const [what, body] of cases) {
      expect([what, (await h.post("attacker", body)).status]).toEqual([what, 422]);
    }
    expect(h.engine.settlement("o-v")).toBeUndefined();
    expect(h.engine.notesFor("o-v-c")).toEqual([]);
    expect(h.engine.recoveries.for("o-v")).toBeUndefined();
    expect(h.deliveries.forHousehold(["o-v"])).toEqual([]);
  });

  test("another household's recovery record is refused", async () => {
    // NOTE (mutation check, 2026-09-15): import_recovery_any_household. The
    // import answered 201.
    const h = host();
    const r = await h.post("attacker", { recoveries: [{ id: "r-1", household: "victim", initiated_by: "x", at: 1, notified: [] }] });
    expect(r.status).toBe(422);
  });

  test("receipts, the recovery log, permissions and queries are added to, never replaced", async () => {
    // NOTE (mutation check, 2026-09-15): import_receipts_replaced,
    // import_log_replaced and import_permissions_replaced each put the
    // replacement back. The first row was gone after the second import.
    const h = host();
    const first = {
      receipts: [{ ref: "r-1", at: 1 }],
      recoveries: [{ id: "l-1", household: "h", initiated_by: "x", at: 1, notified: [] }],
      permissions: [{ id: "p-1", kind: "party", grantee: "g", scope: ["kept_as"], purpose: "p", expires_at: 9e15, asked_from: "a", granted_at: 1, result_form: null, revoked_at: null }],
      queries: [{ id: "q-1", asked_by: "g", product: "p", answered: false, at: 1 }],
    };
    const second = {
      receipts: [{ ref: "r-2", at: 2 }],
      recoveries: [{ id: "l-2", household: "h", initiated_by: "x", at: 2, notified: [] }],
      permissions: [{ id: "p-2", kind: "party", grantee: "g", scope: ["kept_as"], purpose: "p", expires_at: 9e15, asked_from: "a", granted_at: 2, result_form: null, revoked_at: null }],
      queries: [{ id: "q-2", asked_by: "g", product: "p", answered: false, at: 2 }],
    };
    expect((await h.post("h", first)).status).toBe(201);
    expect((await h.post("h", second)).status).toBe(201);
    expect(h.engine.receiptsFor("h").map((r) => r.ref)).toEqual(["r-1", "r-2"]);
    expect(h.recovery.logFor("h").map((r) => r.id)).toEqual(["l-1", "l-2"]);
    const held = h.permissions.exportFor("h");
    expect(held.permissions.map((p) => p.id)).toEqual(["p-1", "p-2"]);
    expect(held.queries.map((q) => q.id)).toEqual(["q-1", "q-2"]);
  });
});

describe("§14.2, §7.1: an imported edge", () => {
  const edge = (from: string, to: string) => ({
    from, to, product: "tea-a", merchant: "maker-a", maker: "made-by-tea", kind: "gift" as const, occasion: "", receipt: "r-1",
  });

  test("never replaces an edge this host holds, and the same edge arriving twice is not a refusal", async () => {
    // NOTE (mutation check, 2026-09-15): import_edge_replaces_held. The import
    // under h answered 201 and g's edge to x was gone. The signed bytes carry
    // no id, so h could sign an edge of its own under g's edge's id.
    const h = host();
    const g = signer(); const hh = signer();
    h.engine.registerIdentity("g", g.pem); h.engine.registerIdentity("h", hh.pem);
    const theirs = { id: "e-1", ...edge("g", "x"), signature: g.sign(edge("g", "x")), attested: false, created_at: 1 };
    expect((await h.post("g", { lineage: [theirs] })).status).toBe(201);
    const forged = { id: "e-1", ...edge("h", "g"), signature: hh.sign(edge("h", "g")), attested: false, created_at: 1 };
    expect((await h.post("h", { lineage: [forged] })).status).toBe(201);
    // g's edge stands where it was, and h's own edge is written under an id
    // this host derived, so squatting an id neither erases a row nor blocks
    // the move of the household that holds it.
    expect(h.engine.edgesTouching("x").map((e) => [e.id, e.from])).toEqual([["e-1", "g"]]);
    const mine = h.engine.edgesTouching("h");
    expect(mine.length).toBe(1);
    expect(mine[0]!.id.startsWith("e-1~")).toBe(true);
    // x moves too, carrying the same edge: that is not a change, and the same
    // edge is not filed twice because one of the two copies was re-keyed.
    // NOTE (mutation check, 2026-09-15): import_edge_filed_twice. x held two
    // rows for one gift.
    expect((await h.post("x", { lineage: [theirs] })).status).toBe(201);
    expect(h.engine.edgesTouching("x").length).toBe(1);
  });

  test("takes its attestation from this host, not from the body", async () => {
    // NOTE (mutation check, 2026-09-15): import_trusts_attested. The edge was
    // stored as attested, which makes a product known to its recipient
    // (§5.1) on the word of a key no root endorsed.
    const h = host();
    const k = signer();
    h.engine.registerIdentity("h", k.pem);
    const claimed = { id: "e-2", ...edge("h", "g"), signature: k.sign(edge("h", "g")), attested: true, created_at: 1 };
    expect((await h.post("h", { lineage: [claimed] })).status).toBe(201);
    expect(h.engine.edgesTouching("h")[0]?.attested).toBe(false);
  });
});

describe("§14.2: a mandate that arrives again", () => {
  test("unchanged, it is accepted and left as it was", async () => {
    // NOTE (mutation check, 2026-09-15): import_mandate_identical_refused. The
    // second import answered 409: a hub that recorded the mandate before the
    // node moved could not move the node at all.
    const h = host();
    expect((await h.post("victim", { mandates: [mandate("victim")] })).status).toBe(201);
    const reordered = Object.fromEntries(Object.entries(mandate("victim")).reverse());
    expect((await h.post("victim", { mandates: [reordered] })).status).toBe(201);
    expect(h.engine.mandates.get("m-victim")?.co_signers).toEqual(["cs"]);
  });
});

describe("§14.2, clause 9: what an import may not carry", () => {
  const grant = (over: Record<string, unknown> = {}) => ({
    id: "p-1", kind: "party", grantee: "g", scope: ["kept_as"], purpose: "p", expires_at: 9e15,
    asked_from: "a", granted_at: 1, result_form: null, revoked_at: null, ...over,
  });

  test("a grant that could not have been made here", async () => {
    // NOTE (mutation check, 2026-09-15): import_permission_unchecked. Both
    // assertions answered 201: a move carried the household as its own
    // grantee (clause 38) and a computation with no aggregate (clause 9).
    const h = host();
    expect((await h.post("h", { permissions: [grant({ grantee: "h" })] })).status).toBe(422);
    expect((await h.post("h", { permissions: [grant({ kind: "computation", result_form: null })] })).status).toBe(422);
    expect(h.permissions.exportFor("h").permissions).toEqual([]);
  });

  test("one row named twice", async () => {
    // NOTE (mutation check, 2026-09-15): import_row_named_twice. The import
    // answered 201 with both rows written, and revoking the permission found
    // the revoked copy while the live one went on granting.
    const h = host();
    const r = await h.post("h", { permissions: [grant({ revoked_at: 1 }), grant()] });
    expect(r.status).toBe(400);
    expect(h.permissions.exportFor("h").permissions).toEqual([]);
    expect((await h.post("h", { receipts: [{ ref: "r-1", at: 1 }, { ref: "r-1", at: 2 }] })).status).toBe(400);
  });

  test("an edge whose kind is not one of the four", async () => {
    // NOTE (mutation check, 2026-09-15): import_edge_fields_unchecked. The
    // import answered 201: `["gift"]` encodes to the bytes `gift` does, so it
    // verifies, and the edge was stored with a list where its kind goes.
    const h = host();
    const k = signer();
    h.engine.registerIdentity("h", k.pem);
    const body = { from: "h", to: "g", product: "tea-a", merchant: "maker-a", maker: "made-by-tea", kind: "gift" as const, occasion: "", receipt: "r-9" };
    const listed = { id: "e-9", ...body, kind: ["gift"], signature: k.sign(body), attested: false, created_at: 1 };
    expect((await h.post("h", { lineage: [listed] })).status).toBe(400);
    expect(h.engine.edgesTouching("h")).toEqual([]);
  });
});

describe("§14.2, clause 9: a grant's scope", () => {
  test("a grant whose scope names nothing is refused", async () => {
    // NOTE (mutation check, 2026-09-15): import_grant_without_scope. The
    // import answered 201, and reading that household's permissions then
    // raised for good: `grant` refuses the same row, and no revocation can
    // remove one that arrived by a move.
    const h = host();
    const grant = { id: "p-9", kind: "party", grantee: "g", purpose: "p", expires_at: 9e15, asked_from: "a", granted_at: 1, result_form: null, revoked_at: null };
    expect((await h.post("h", { permissions: [{ ...grant, scope: [] }] })).status).toBe(400);
    expect((await h.post("h", { permissions: [{ ...grant, scope: "kept_as" }] })).status).toBe(400);
    expect(h.permissions.exportFor("h").permissions).toEqual([]);
  });
});
