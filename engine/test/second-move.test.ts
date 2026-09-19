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
import { houseFor } from "./helpers.js";

const HOME = houseFor("second-move").household;

/**
 * §14.2, question 59, decided 2026-09-19. An offer this host holds exactly as
 * it arrives has been carried already, and so have its rows: each must match
 * what this host holds. The conformance suite reaches settlements and notes
 * over two hosts; the rows here are the ones a probe would need a collected
 * physical box or a captured confirmation to reach, so they are proven on the
 * route directly.
 */
function host() {
  const store = inMemoryStore();
  const engine = new ValenceEngine(new InMemoryLedger(), {
    explorationRate: 0.2, reminderLimit: 1, recoveryGraceDays: 3, relyingPartyId: "unit.example",
  }, store);
  const deliveries = new DeliveryRegister(store);
  const handle = createApp(engine, {
    deliveries, approvals: new ApprovalDesk(store), recovery: new RecoveryRegister(store),
    permissions: new PermissionLedger(store), registry: new Registry(store),
  });
  const post = async (body: Record<string, unknown>) =>
    handle(new Request(`https://unit.example/households/${HOME}/import`, {
      method: "POST", body: JSON.stringify({ format: "valence-node/7", ...body }),
    }));
  return { engine, deliveries, post };
}

const offer = { id: "o1", household: HOME, mandate: `${HOME}.1`, binding: "physical", state: "settled", candidates: [{ id: "o1-c", valence: "returned" }] };
const collection = { offer: "o1", due_at: 1, grace_days: 3, collected_at: 2, returned: ["o1-c"], consumed: [], missing: [], missing_notes: {} };
const delivery = { offer: "o1", carriage: 550, code: "private-code", status: "delivered", updated_at: 1 };
const first = { offers: [offer], collections: [collection], deliveries: [delivery], confirmations: { o1: ["t1"] } };

describe("§14.2, question 59: a second move writes nothing the first carried", () => {
  test("the same body again is accepted and changes nothing", async () => {
    const h = host();
    expect((await h.post(first)).status).toBe(201);
    expect((await h.post(first)).status).toBe(201);
    expect(h.engine.confirmationsFor(["o1"])).toEqual({ o1: ["t1"] });
  });

  test("a collection that differs from the one held is refused", async () => {
    // NOTE (mutation check, 2026-09-19): carried_collection_not_compared. The
    // import answered 201 with the box read as consumed.
    const h = host();
    expect((await h.post(first)).status).toBe(201);
    const r = await h.post({ ...first, collections: [{ ...collection, returned: [], consumed: ["o1-c"] }] });
    expect(r.status).toBe(409);
    expect(h.engine.recoveries.for("o1")?.returned).toEqual(["o1-c"]);
  });

  test("a delivery's status may have moved on, and the host keeps its own row; its code may not", async () => {
    // NOTE (mutation check, 2026-09-19): carried_delivery_not_compared. The
    // import with another code answered 201.
    const h = host();
    expect((await h.post(first)).status).toBe(201);
    expect((await h.post({ ...first, deliveries: [{ ...delivery, status: "returned", updated_at: 9 }] })).status).toBe(201);
    expect(h.deliveries.find("o1")).toEqual(delivery);
    expect((await h.post({ ...first, deliveries: [{ ...delivery, code: "someone-else" }] })).status).toBe(409);
  });

  test("a confirmation token the host does not hold for a carried offer is refused", async () => {
    // NOTE (mutation check, 2026-09-19): carried_confirmations_not_compared.
    // The import answered 201 and the register held a second token.
    const h = host();
    expect((await h.post(first)).status).toBe(201);
    expect((await h.post({ ...first, confirmations: { o1: ["t1", "t2"] } })).status).toBe(409);
    expect(h.engine.confirmationsFor(["o1"])).toEqual({ o1: ["t1"] });
  });

  test("a settlement for a carried offer the host has none for is refused", async () => {
    const h = host();
    expect((await h.post(first)).status).toBe(201);
    const settlement = { offer: "o1", settled_at: 3, charged: 0, signed_by: "p", receipt: "r" };
    expect((await h.post({ ...first, settlements: [settlement] })).status).toBe(409);
    expect(h.engine.settlement("o1")).toBeUndefined();
  });
});
