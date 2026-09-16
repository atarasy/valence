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
import { houseFor, signer } from "./helpers.js";

// §13.2, question 55. A household identifier is the name of its key, so the
// readable label survives only as the seed these are derived from.
const HOME = houseFor("h");
const VICTIM = houseFor("victim");
const ATTACKER = houseFor("attacker");
const X = houseFor("x");
// A giver is a household too: an edge arrives on the giver's own path when it moves.
const G = houseFor("g");
const M_VICTIM = `${VICTIM.household}.m`;


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
  id: `${household}.m`, household, ceiling_out_of_network: 1000, co_signers: ["cs"], ceiling_daily: null,
  cooling_seconds: 3600, lapses_at: 9e15, version: 3, ...over,
});
// §13.2, question 55. An export always carries a mandate, and its identifier is the household's.
const offer = (id: string, household: string) => ({ id, household, mandate: `${household}.1`, candidates: [{ id: `${id}-c` }] });
const collection = (id: string) => ({ offer: id, due_at: 1, grace_days: 3, collected_at: null, returned: [], consumed: [], missing: [], missing_notes: {} });

describe("§14.2: an import writes only its own household's rows", () => {
  test("another household's mandate is refused and left as it was", async () => {
    // NOTE (mutation check, 2026-09-15): import_mandate_any_household. The
    // import answered 201 and the victim's mandate read an empty co-signer list.
    const h = host();
    expect((await h.post(VICTIM.household, { mandates: [mandate(VICTIM.household)] })).status).toBe(201);
    const r = await h.post(ATTACKER.household, { mandates: [mandate(VICTIM.household, { ceiling_out_of_network: 1e12, co_signers: [], cooling_seconds: null, version: 1 })] });
    expect(r.status).toBe(422);
    expect(h.engine.mandates.get(M_VICTIM)).toMatchObject({ ceiling_out_of_network: 1000, co_signers: ["cs"], cooling_seconds: 3600, version: 3 });
  });

  test("a mandate this host already holds is not replaced, even by its own household", async () => {
    // NOTE (mutation check, 2026-09-15): import_mandate_replaces_held. The
    // second row was written, and with it a mandate nobody signed.
    //
    // Taking the tighter of the two read well and froze a household out: a
    // ceiling of 0, a lapse in the past and a co-signer whose key nobody holds
    // are all tightenings, so they were taken unsigned, and undoing them is a
    // loosening that needs that key's signature. So a held mandate is left
    // alone, and neither row is refused: refusing would let a mandate that
    // arrived first block the household's move.
    const h = host();
    expect((await h.post(VICTIM.household, { mandates: [mandate(VICTIM.household)] })).status).toBe(201);
    for (const over of [{ co_signers: [] }, { co_signers: ["cs", "cs2"], ceiling_out_of_network: 0, lapses_at: 1, version: 9 }]) {
      const again = await h.post(VICTIM.household, { mandates: [mandate(VICTIM.household, over)] });
      expect(again.status).toBe(201);
      expect(h.engine.mandates.get(M_VICTIM)).toMatchObject({ co_signers: ["cs"], ceiling_out_of_network: 1000, version: 3 });
    }
  });

  test("a settlement, a note, a collection and a delivery must name an offer the import carries", async () => {
    // NOTE (mutation check, 2026-09-15): import_settlement_unscoped,
    // import_note_unscoped, import_collection_unscoped and
    // import_delivery_unscoped each let their row through. Each case below
    // failed with 201 under its own mutation.
    const h = host();
    expect((await h.post(VICTIM.household, { offers: [offer("o-v", VICTIM.household)] })).status).toBe(201);
    const cases: [string, Record<string, unknown>][] = [
      ["settlement", { settlements: [{ offer: "o-v", settled_at: 1, kept_amount: 0, consumed_amount: 0 }] }],
      ["note", { notes: [{ candidate: "o-v-c", author: "a", text: "t", shared_with: [], created_at: 1 }] }],
      ["collection", { collections: [collection("o-v")] }],
      ["delivery", { deliveries: [{ offer: "o-v", carriage: 1, code: "c", status: "placed", updated_at: 1 }] }],
    ];
    for (const [what, body] of cases) {
      expect([what, (await h.post(ATTACKER.household, body)).status]).toEqual([what, 422]);
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
    const r = await h.post(ATTACKER.household, { recoveries: [{ id: "r-1", household: VICTIM.household, initiated_by: "x", at: 1, notified: [] }] });
    expect(r.status).toBe(422);
  });

  test("receipts, the recovery log, permissions and queries are added to, never replaced", async () => {
    // NOTE (mutation check, 2026-09-15): import_receipts_replaced,
    // import_log_replaced and import_permissions_replaced each put the
    // replacement back. The first row was gone after the second import.
    const h = host();
    const first = {
      receipts: [{ ref: "r-1", at: 1 }],
      recoveries: [{ id: "l-1", household: HOME.household, initiated_by: "x", at: 1, notified: [] }],
      permissions: [{ id: "p-1", kind: "party", grantee: "g", scope: ["kept_as"], purpose: "p", expires_at: 9e15, asked_from: "a", granted_at: 1, result_form: null, revoked_at: null }],
      queries: [{ id: "q-1", asked_by: "g", product: "p", answered: false, at: 1 }],
    };
    const second = {
      receipts: [{ ref: "r-2", at: 2 }],
      recoveries: [{ id: "l-2", household: HOME.household, initiated_by: "x", at: 2, notified: [] }],
      permissions: [{ id: "p-2", kind: "party", grantee: "g", scope: ["kept_as"], purpose: "p", expires_at: 9e15, asked_from: "a", granted_at: 2, result_form: null, revoked_at: null }],
      queries: [{ id: "q-2", asked_by: "g", product: "p", answered: false, at: 2 }],
    };
    expect((await h.post(HOME.household, first)).status).toBe(201);
    expect((await h.post(HOME.household, second)).status).toBe(201);
    expect(h.engine.receiptsFor(HOME.household).map((r) => r.ref)).toEqual(["r-1", "r-2"]);
    expect(h.recovery.logFor(HOME.household).map((r) => r.id)).toEqual(["l-1", "l-2"]);
    const held = h.permissions.exportFor(HOME.household);
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
    const g = signer(); const hh = HOME;
    h.engine.registerIdentity(G.household, G.pem); h.engine.registerIdentity(HOME.household, HOME.pem);
    const theirs = { id: "e-1", ...edge(G.household, X.household), signature: G.signEdge(edge(G.household, X.household)), attested: false, created_at: 1 };
    expect((await h.post(G.household, { lineage: [theirs] })).status).toBe(201);
    const forged = { id: "e-1", ...edge(HOME.household, G.household), signature: hh.signEdge(edge(HOME.household, G.household)), attested: false, created_at: 1 };
    expect((await h.post(HOME.household, { lineage: [forged] })).status).toBe(201);
    // g's edge stands where it was, and h's own edge is written under an id
    // this host derived, so squatting an id neither erases a row nor blocks
    // the move of the household that holds it.
    expect(h.engine.edgesTouching(X.household).map((e) => [e.id, e.from])).toEqual([["e-1", G.household]]);
    const mine = h.engine.edgesTouching(HOME.household);
    expect(mine.length).toBe(1);
    expect(mine[0]!.id.startsWith("e-1~")).toBe(true);
    // x moves too, carrying the same edge: that is not a change, and the same
    // edge is not filed twice because one of the two copies was re-keyed.
    // NOTE (mutation check, 2026-09-15): import_edge_filed_twice. x held two
    // rows for one gift.
    expect((await h.post(X.household, { lineage: [theirs] })).status).toBe(201);
    expect(h.engine.edgesTouching(X.household).length).toBe(1);
  });

  test("takes its attestation from this host, not from the body", async () => {
    // NOTE (mutation check, 2026-09-15): import_trusts_attested. The edge was
    // stored as attested, which makes a product known to its recipient
    // (§5.1) on the word of a key no root endorsed.
    const h = host();
    const k = HOME;
    h.engine.registerIdentity(HOME.household, HOME.pem);
    const claimed = { id: "e-2", ...edge(HOME.household, G.household), signature: k.signEdge(edge(HOME.household, G.household)), attested: true, created_at: 1 };
    expect((await h.post(HOME.household, { lineage: [claimed] })).status).toBe(201);
    expect(h.engine.edgesTouching(HOME.household)[0]?.attested).toBe(false);
  });
});

describe("§14.2: a mandate that arrives again", () => {
  test("unchanged, it is accepted and left as it was", async () => {
    // NOTE (mutation check, 2026-09-15): import_mandate_identical_refused. The
    // second import answered 409: a hub that recorded the mandate before the
    // node moved could not move the node at all.
    const h = host();
    expect((await h.post(VICTIM.household, { mandates: [mandate(VICTIM.household)] })).status).toBe(201);
    const reordered = Object.fromEntries(Object.entries(mandate(VICTIM.household)).reverse());
    expect((await h.post(VICTIM.household, { mandates: [reordered] })).status).toBe(201);
    expect(h.engine.mandates.get(M_VICTIM)?.co_signers).toEqual(["cs"]);
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
    expect((await h.post(HOME.household, { permissions: [grant({ grantee: HOME.household })] })).status).toBe(422);
    expect((await h.post(HOME.household, { permissions: [grant({ kind: "computation", result_form: null })] })).status).toBe(422);
    expect(h.permissions.exportFor(HOME.household).permissions).toEqual([]);
  });

  test("one row named twice", async () => {
    // NOTE (mutation check, 2026-09-15): import_row_named_twice. The import
    // answered 201 with both rows written, and revoking the permission found
    // the revoked copy while the live one went on granting.
    const h = host();
    const r = await h.post(HOME.household, { permissions: [grant({ revoked_at: 1 }), grant()] });
    expect(r.status).toBe(400);
    expect(h.permissions.exportFor(HOME.household).permissions).toEqual([]);
    expect((await h.post(HOME.household, { receipts: [{ ref: "r-1", at: 1 }, { ref: "r-1", at: 2 }] })).status).toBe(400);
  });

  test("an edge whose kind is not one of the four", async () => {
    // NOTE (mutation check, 2026-09-15): import_edge_fields_unchecked. The
    // import answered 201: `["gift"]` encodes to the bytes `gift` does, so it
    // verifies, and the edge was stored with a list where its kind goes.
    const h = host();
    const k = HOME;
    h.engine.registerIdentity(HOME.household, HOME.pem);
    const body = { from: HOME.household, to: G.household, product: "tea-a", merchant: "maker-a", maker: "made-by-tea", kind: "gift" as const, occasion: "", receipt: "r-9" };
    const listed = { id: "e-9", ...body, kind: ["gift"], signature: k.signEdge(body), attested: false, created_at: 1 };
    expect((await h.post(HOME.household, { lineage: [listed] })).status).toBe(400);
    expect(h.engine.edgesTouching(HOME.household)).toEqual([]);
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
    expect((await h.post(HOME.household, { permissions: [{ ...grant, scope: [] }] })).status).toBe(400);
    expect((await h.post(HOME.household, { permissions: [{ ...grant, scope: "kept_as" }] })).status).toBe(400);
    expect(h.permissions.exportFor(HOME.household).permissions).toEqual([]);
  });
});

describe("§14.2, §16.1: mandates that arrive by a move", () => {
  test("a body naming one mandate twice is refused, and nothing is written", async () => {
    // NOTE (mutation check, 2026-09-15): import_mandate_named_twice. The body
    // answered 201 with no mandate stored at all, because the looser row took
    // the tighter one out of the import with it: the household landed with no
    // ceiling, no co-signers and no lapse.
    const h = host();
    const r = await h.post(VICTIM.household, { mandates: [mandate(VICTIM.household, { ceiling_out_of_network: 10, version: 5 }), mandate(VICTIM.household, { ceiling_out_of_network: 1e9, co_signers: [], version: 6 })] });
    expect(r.status).toBe(400);
    expect(h.engine.mandates.get(M_VICTIM)).toBeUndefined();
  });

  test("a lapse that is not a number is refused", async () => {
    // NOTE (mutation check, 2026-09-15): import_mandate_fields_unchecked. The
    // mandate imported with `lapses_at: "never"`, and nothing ever read it as
    // lapsed.
    const h = host();
    expect((await h.post(VICTIM.household, { mandates: [mandate(VICTIM.household, { lapses_at: "never" })] })).status).toBe(400);
    expect(h.engine.mandates.get(M_VICTIM)).toBeUndefined();
  });
});

describe("§7.1: two gifts that sign the same bytes", () => {
  const body = { from: HOME.household, to: G.household, product: "tea-a", merchant: "maker-a", maker: "made-by-tea", kind: "gift" as const, occasion: "", receipt: "" };

  test("are two edges, and a squatted id does not refuse the move", async () => {
    // NOTE (mutation check, 2026-09-15): import_edge_scan_is_global made the
    // second gift the first one again, and import_edge_squat_refused answered
    // 409 for the third import, refusing a whole move over an id.
    const h = host();
    const k = HOME;
    h.engine.registerIdentity(HOME.household, HOME.pem);
    const signed = k.signEdge(body);
    const first = { id: "g-1", ...body, signature: signed, attested: false, created_at: 1 };
    const second = { id: "g-2", ...body, signature: signed, attested: false, created_at: 2 };
    expect((await h.post(HOME.household, { lineage: [first] })).status).toBe(201);
    expect((await h.post(HOME.household, { lineage: [second] })).status).toBe(201);
    expect(h.engine.edgesTouching(HOME.household).length).toBe(2);
    // A third copy under an id already taken by another edge is filed beside
    // it rather than refused.
    const other = { ...body, receipt: "r-other" };
    const third = { id: "g-1", ...other, signature: k.signEdge(other), attested: false, created_at: 3 };
    expect((await h.post(HOME.household, { lineage: [third] })).status).toBe(201);
    expect(h.engine.edgesTouching(HOME.household).length).toBe(3);
  });
});

describe("§16.1: a mandate does not change hands", () => {
  test("an import under one household cannot take another's mandate id", async () => {
    // NOTE (mutation check, 2026-09-15): import_mandate_changes_hands. The
    // import answered 201, the victim's mandate was gone from its own list,
    // and the victim's own record was then refused as the wrong household.
    // Every value the attacker needs is tighter, so it can be chosen blind.
    // §13.2, question 55, decided 2026-09-16. The attacker can no longer
    // compose the row at all: a mandate identifier begins with its household's,
    // which is that household's key, so a body under the attacker's path
    // naming the victim's mandate is refused before the 409 below is reached.
    const h = host();
    expect((await h.post(VICTIM.household, { mandates: [mandate(VICTIM.household)] })).status).toBe(201);
    const taken = await h.post(ATTACKER.household, {
      mandates: [{ ...mandate(VICTIM.household, { ceiling_out_of_network: 1, co_signers: ["cs", "x"], cooling_seconds: 99999, lapses_at: 1, version: 9 }), household: ATTACKER.household }],
    });
    expect(taken.status).toBe(422);
    expect(await taken.json()).toMatchObject({ error: "name_is_not_the_key" });
    expect(h.engine.mandates.forHousehold(VICTIM.household).map((m) => m.id)).toEqual([M_VICTIM]);
    expect(h.engine.mandates.forHousehold(ATTACKER.household)).toEqual([]);
  });

  test("a held row under an id of this household's still refuses a change of hands", async () => {
    // The 409 above is now behind §13.2's shape on this route, so it is
    // reached here by planting the held row the way a host running the older
    // rule would hold one. An unreachable guard is one nothing proves, and
    // this project has shipped one before.
    const h = host();
    const id = `${ATTACKER.household}.m`;
    h.engine.mandates.importMandate({ ...mandate(VICTIM.household), id, household: VICTIM.household } as never);
    const r = await h.post(ATTACKER.household, { mandates: [{ ...mandate(ATTACKER.household), id }] });
    expect(r.status).toBe(409);
    expect(h.engine.mandates.get(id)?.household).toBe(VICTIM.household);
  });

  test("a mandate's numbers are whole and in range", async () => {
    // NOTE (mutation check, 2026-09-15): import_mandate_numbers_unchecked.
    // A lapse of -5, a version of 1.5 and a null out-of-network ceiling all
    // imported, while `record` refuses each of them.
    const h = host();
    for (const bad of [{ lapses_at: -5 }, { version: 1.5 }, { ceiling_out_of_network: null }]) {
      expect([Object.keys(bad)[0], (await h.post(VICTIM.household, { mandates: [mandate(VICTIM.household, bad)] })).status]).toEqual([Object.keys(bad)[0], 400]);
    }
    expect(h.engine.mandates.get(M_VICTIM)).toBeUndefined();
  });
});

describe("§7.1: an edge whose own id holds a tilde", () => {
  test("keeps its id", async () => {
    // NOTE (mutation check, 2026-09-15): import_edge_id_split_anywhere filed
    // it under the part before the tilde, and it stayed renamed through every
    // later move. Nobody signs an id, so nothing else would have caught it.
    const h = host();
    const k = HOME;
    h.engine.registerIdentity(HOME.household, HOME.pem);
    const body = { from: HOME.household, to: G.household, product: "tea-a", merchant: "maker-a", maker: "made-by-tea", kind: "gift" as const, occasion: "", receipt: "r-tilde" };
    expect((await h.post(HOME.household, { lineage: [{ id: "gift~2026", ...body, signature: k.signEdge(body), attested: false, created_at: 1 }] })).status).toBe(201);
    expect(h.engine.edgesTouching(HOME.household).map((e) => e.id)).toEqual(["gift~2026"]);
  });
});
