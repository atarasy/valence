import { expect, test } from "bun:test";
import { createApp } from "../src/http.js";
import { CarriageQuotes } from "../src/hub/carriage-quote.js";
import { DeliveryRegister } from "../src/hub/delivery.js";
import { ApprovalDesk } from "../src/hub/approval.js";
import { RecoveryRegister } from "../src/hub/node.js";
import { PermissionLedger } from "../src/hub/permissions.js";
import { Registry } from "../src/shared/registry.js";
import { makeEngine, HOUSEHOLD, MANDATE, CONFIG_VERSION, HOUR } from "./helpers.js";

function host() {
  const { engine } = makeEngine();
  const app = createApp(engine, { quotes: new CarriageQuotes(), deliveries: new DeliveryRegister(), approvals: new ApprovalDesk(), recovery: new RecoveryRegister(), permissions: new PermissionLedger(), registry: new Registry() });
  return { engine, app };
}
const path = (household: string) => `https://unit.example/households/${encodeURIComponent(household)}/leave`;

test("§14.3: the route answers the blockers, refuses while one holds, and deletes when none does", async () => {
  const h = host(), now = Date.now();
  const offer = h.engine.createOffer({ binding: "digital", household: HOUSEHOLD, purpose: "replenish", config_version: CONFIG_VERSION, expires_at: now + HOUR, mandate: MANDATE, price_band: null, giver: null, candidates: [{ product: "tea-a", quantity: 1, predicted_conversion: 0.5, is_exploration: true, given_by: null }] }, now);
  h.engine.present(offer.id, now);

  const listed = await (await h.app(new Request(path(HOUSEHOLD)))).json() as { household: string; blockers: { kind: string; id: string }[] };
  expect(listed.household).toBe(HOUSEHOLD);
  expect(listed.blockers).toContainEqual({ kind: "offer_in_progress", id: offer.id });

  const refused = await h.app(new Request(path(HOUSEHOLD), { method: "POST" }));
  expect(refused.status).toBe(409);
  expect((await refused.json() as { error: string }).error).toBe("leave_blocked");
  // A refused deletion writes nothing: the offer is still here.
  expect(h.engine.mustGet(offer.id)).toBeDefined();

  // The offer expires, owing nothing, and the household can leave.
  const later = now + 2 * HOUR;
  h.engine.sweep(later);
  await h.engine.settleWhatOwesNothing(HOUSEHOLD);
  expect(((await (await h.app(new Request(path(HOUSEHOLD)))).json()) as { blockers: unknown[] }).blockers).toEqual([]);
  const deleted = await h.app(new Request(path(HOUSEHOLD), { method: "POST" }));
  expect(deleted.status).toBe(200);
  expect((await deleted.json() as { deleted: Record<string, number> }).deleted.offers).toBe(1);
  expect(h.engine.departures().map((d) => d.household)).toEqual([HOUSEHOLD]);
});

test("§14.3: the household in the path is decoded, so an identifier with a colon is the one that leaves", async () => {
  const h = host();
  // `HOUSEHOLD` is a key name and carries a colon; the raw segment would be another household.
  expect(HOUSEHOLD).toContain(":");
  const answered = await (await h.app(new Request(path(HOUSEHOLD)))).json() as { household: string };
  expect(answered.household).toBe(HOUSEHOLD);
  const raw = await (await h.app(new Request(`https://unit.example/households/${HOUSEHOLD}/leave`))).json() as { household: string };
  expect(raw.household).toBe(HOUSEHOLD);
});
