import { expect, test } from "bun:test";
import { createApp } from "../src/http.js";
import { CarriageQuotes } from "../src/hub/carriage-quote.js";
import { DeliveryRegister } from "../src/hub/delivery.js";
import { ApprovalDesk } from "../src/hub/approval.js";
import { RecoveryRegister } from "../src/hub/node.js";
import { PermissionLedger } from "../src/hub/permissions.js";
import { Registry } from "../src/shared/registry.js";
import { sign } from "node:crypto";
import { canonicalLeave } from "../src/hub/leave.js";
import { makeEngine, HOUSEHOLD, MANDATE, CONFIG_VERSION, HOUR, MANDATE_PAIR } from "./helpers.js";

function host() {
  const { engine } = makeEngine();
  const app = createApp(engine, { quotes: new CarriageQuotes(), deliveries: new DeliveryRegister(), approvals: new ApprovalDesk(), recovery: new RecoveryRegister(), permissions: new PermissionLedger(), registry: new Registry() });
  return { engine, app };
}
const path = (household: string) => `https://unit.example/households/${encodeURIComponent(household)}/leave`;
const signedLeave = (household: string, rpID: string) => ({ signature: sign(null, canonicalLeave(household, rpID), MANDATE_PAIR.privateKey).toString("base64") });
const post = (h: ReturnType<typeof host>, household: string, body: unknown) => h.app(new Request(path(household), { method: "POST", body: JSON.stringify(body) }));

test("§14.3: the route answers the blockers, refuses while one holds, and deletes when none does", async () => {
  const h = host(), now = Date.now();
  const offer = h.engine.createOffer({ binding: "digital", household: HOUSEHOLD, purpose: "replenish", config_version: CONFIG_VERSION, expires_at: now + HOUR, mandate: MANDATE, price_band: null, giver: null, candidates: [{ product: "tea-a", quantity: 1, predicted_conversion: 0.5, is_exploration: true, given_by: null }] });
  h.engine.present(offer.id, now);

  const listed = await (await h.app(new Request(path(HOUSEHOLD)))).json() as { household: string; blockers: { kind: string; id: string }[] };
  expect(listed.household).toBe(HOUSEHOLD);
  expect(listed.blockers).toContainEqual({ kind: "offer_in_progress", id: offer.id });

  const refused = await post(h, HOUSEHOLD, signedLeave(HOUSEHOLD, h.engine.relyingPartyId));
  expect(refused.status).toBe(409);
  expect((await refused.json() as { error: string }).error).toBe("leave_blocked");
  // A refused deletion writes nothing: the offer is still here.
  expect(h.engine.mustGet(offer.id)).toBeDefined();

  // The offer expires, owing nothing, and the household can leave.
  const later = now + 2 * HOUR;
  h.engine.sweep(later);
  await h.engine.settleWhatOwesNothing(HOUSEHOLD);
  expect(((await (await h.app(new Request(path(HOUSEHOLD)))).json()) as { blockers: unknown[] }).blockers).toEqual([]);
  const deleted = await post(h, HOUSEHOLD, signedLeave(HOUSEHOLD, h.engine.relyingPartyId));
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

test("§14.3: the route deletes nothing without the household's own signature", async () => {
  const h = host();
  h.engine.registerIdentity(HOUSEHOLD, MANDATE_PAIR.publicKey.export({ type: "spki", format: "pem" }).toString());
  for (const body of [{}, { signature: "" }, { signature: Buffer.from("not a signature").toString("base64") }, { signature: sign(null, canonicalLeave(HOUSEHOLD, "another.example"), MANDATE_PAIR.privateKey).toString("base64") }, { signature: sign(null, canonicalLeave("key:someone-else", h.engine.relyingPartyId), MANDATE_PAIR.privateKey).toString("base64") }]) {
    const answer = await post(h, HOUSEHOLD, body);
    expect(answer.status).toBe(422);
    expect(["unsigned", "bad_signature"]).toContain((await answer.json() as { error: string }).error);
    expect(h.engine.departures()).toEqual([]);
  }
  const ok = await post(h, HOUSEHOLD, signedLeave(HOUSEHOLD, h.engine.relyingPartyId));
  expect(ok.status).toBe(200);
});
