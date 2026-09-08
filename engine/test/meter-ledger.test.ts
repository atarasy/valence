import { afterAll, describe, expect, test } from "bun:test";
import { MeterLedger } from "../src/meter-ledger.js";
import { ValenceEngine } from "../src/engine.js";
import { CONFIG_VERSION, HOUR, decideSigned, MANDATE_PAIR } from "./helpers.js";

/**
 * The adapter is tested against a stand-in that reproduces the behaviour
 * measured in Meter on 2026-09-08, not against an idealised ledger.
 *
 * The measurement that matters: `commitReservedUsage` does not refuse a commit
 * above the held amount. It charges the difference as a `usage_hold_adjustment`
 * and succeeds, and it fails only when the balance cannot cover that
 * difference. So the stand-in below accepts an over-commit while the account is
 * funded, and these tests check that the adapter refuses first.
 *
 * A stand-in written to refuse the over-commit would make every test here pass
 * and prove nothing about the requirement they exist for.
 */

type Row = { requestId: string; credits: number; status: string };

const rows = new Map<string, Row>();
const ledgerCalls: { path: string; body: Record<string, unknown> }[] = [];
let balance = 1_000_000;

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    const body = (await request.json()) as Record<string, unknown>;
    ledgerCalls.push({ path: url.pathname, body });

    if (url.pathname === "/api/v1/meter/authorize") {
      const requestId = String(body.requestId);
      const credits = Number(body.credits);
      const row = rows.get(requestId) ?? { requestId, credits, status: "held" };
      rows.set(requestId, row);
      return Response.json({ authorized: true, reservation: row });
    }

    if (url.pathname === "/api/v1/meter/commit") {
      const requestId = String(body.requestId);
      const credits = Number(body.credits);
      const row = rows.get(requestId);
      if (!row) return Response.json({ error: "no reservation" }, { status: 409 });
      // Meter's actual behaviour: the delta is charged, not refused.
      const delta = credits - row.credits;
      if (delta > 0 && balance < delta) {
        return Response.json({ error: "insufficient_credits" }, { status: 402 });
      }
      balance -= Math.max(0, delta);
      row.credits = credits;
      row.status = "committed";
      return Response.json({ committed: true, balanceCredits: balance });
    }

    if (url.pathname === "/api/v1/meter/release") {
      const row = rows.get(String(body.requestId));
      if (row) row.status = "released";
      return Response.json({ released: true });
    }

    return Response.json({ error: "no such route" }, { status: 404 });
  },
});

afterAll(() => server.stop(true));

const makeLedger = () =>
  new MeterLedger({
    baseUrl: `http://localhost:${server.port}`,
    serviceId: "svc-test",
    apiKey: "key-test",
    tool: "valence.offer",
    provider: "valence",
  });

const makeEngine = (ledger: MeterLedger) => {
  const engine = new ValenceEngine(ledger, {
    explorationRate: 0.2,
    reminderLimit: 1,
    recoveryGraceDays: 3,
  });
  engine.registerIdentity("mandate-1", MANDATE_PAIR.publicKey.export({ type: "spki", format: "pem" }).toString());
  engine.registerConfig({
    version: CONFIG_VERSION,
    presenter: "merchant-1",
    products: { "tea-a": { merchant: "maker-a", ships: "carrier-a", price: 1200 }, "tea-b": { merchant: "maker-a", ships: "carrier-a", price: 900 } },
  });
  return engine;
};

const offerFor = (engine: ValenceEngine) =>
  engine.createOffer({
    binding: "digital",
    household: "house-meter",
    purpose: "replenish",
    config_version: CONFIG_VERSION,
    expires_at: Date.now() + HOUR,
    mandate: "mandate-1",
    price_band: null,
    giver: null,
    candidates: [
      { product: "tea-a", quantity: 1, predicted_conversion: 0.5, is_exploration: false, given_by: null },
      { product: "tea-b", quantity: 1, predicted_conversion: 0.05, is_exploration: true, given_by: null },
    ],
  });

describe("the stand-in behaves as Meter was measured to", () => {
  test("it accepts a commit above the hold while the balance covers it", async () => {
    // If this ever fails, the stand-in has drifted into an idealised ledger
    // and every test below stops proving anything.
    rows.set("direct", { requestId: "direct", credits: 100, status: "held" });
    const response = await fetch(`http://localhost:${server.port}/api/v1/meter/commit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId: "direct", credits: 5_000 }),
    });
    expect(response.status).toBe(200);
  });
});

describe("MeterLedger", () => {
  test("present reserves the offer's upper bound", async () => {
    const ledger = makeLedger();
    const engine = makeEngine(ledger);
    const offer = offerFor(engine);
    await engine.present(offer.id);

    const held = ledger.get(offer.id);
    expect(held!.reserved).toBe(1200 + 900);
    expect(held!.status).toBe("held");
    const authorize = ledgerCalls.filter((c) => c.path.endsWith("/authorize")).pop();
    expect(authorize!.body.requestId).toBe(offer.id);
    expect(authorize!.body.credits).toBe(2100);
  });

  test("settle commits the actual and the difference is not charged", async () => {
    const ledger = makeLedger();
    const engine = makeEngine(ledger);
    const offer = offerFor(engine);
    await engine.present(offer.id);
    decideSigned(engine, offer.id, [
      { candidate: offer.candidates[0]!.id, valence: "kept", kept_as: "self" },
      { candidate: offer.candidates[1]!.id, valence: "returned" },
    ]);
    const settlement = await engine.settle(offer.id);

    expect(settlement.charged).toBe(1200);
    const commit = ledgerCalls.filter((c) => c.path.endsWith("/commit")).pop();
    expect(commit!.body.credits).toBe(1200);
  });

  test("the adapter refuses a settlement above the reserve, funded or not", async () => {
    // The requirement in §6.4, and the one the ledger underneath does not
    // supply. The account has a million credits, so Meter would take this.
    const ledger = makeLedger();
    const engine = makeEngine(ledger);
    const offer = offerFor(engine);
    await engine.present(offer.id);

    const before = ledgerCalls.filter((c) => c.path.endsWith("/commit")).length;
    await expect(
      ledger.commit({ requestId: offer.id, amount: 2101 })
    ).rejects.toThrow(/exceeds the reserved/);
    // Refused before the call, not after it. An adapter that asks and then
    // apologises has already charged the household.
    expect(ledgerCalls.filter((c) => c.path.endsWith("/commit")).length).toBe(before);
  });

  test("an offer that keeps nothing releases and is not charged", async () => {
    const ledger = makeLedger();
    const engine = makeEngine(ledger);
    const now = Date.now();
    const offer = engine.createOffer({
      binding: "digital",
      household: "house-meter",
      purpose: "replenish",
      config_version: CONFIG_VERSION,
      expires_at: now + 1000,
      mandate: "mandate-1",
      price_band: null,
      giver: null,
      candidates: [
        { product: "tea-a", quantity: 1, predicted_conversion: 0.5, is_exploration: false, given_by: null },
        { product: "tea-b", quantity: 1, predicted_conversion: 0.05, is_exploration: true, given_by: null },
      ],
    });
    await engine.present(offer.id, now);
    const settlement = await engine.settle(offer.id, now + 2000);

    expect(settlement.charged).toBe(0);
    expect(ledger.get(offer.id)!.status).toBe("released");
    const release = ledgerCalls.filter((c) => c.path.endsWith("/release")).pop();
    expect(release!.body.requestId).toBe(offer.id);
  });

  test("the offer id is the idempotency key and a re-present does not double the hold", async () => {
    const ledger = makeLedger();
    const engine = makeEngine(ledger);
    const offer = offerFor(engine);
    await engine.present(offer.id);
    const before = ledgerCalls.filter((c) => c.path.endsWith("/authorize")).length;
    await ledger.reserve({
      requestId: offer.id,
      household: "house-meter",
      amount: 2100,
      expiresAt: Date.now() + HOUR,
    });
    expect(ledgerCalls.filter((c) => c.path.endsWith("/authorize")).length).toBe(before);
  });

  test("a ledger that refuses surfaces as a refusal, not as a silent success", async () => {
    balance = 0;
    const ledger = makeLedger();
    rows.set("poor", { requestId: "poor", credits: 10, status: "held" });
    (ledger as unknown as { held: Map<string, unknown> }).held.set("poor", {
      requestId: "poor",
      household: "house-meter",
      reserved: 10_000,
      expiresAt: Date.now() + HOUR,
      status: "held",
      committed: null,
    });
    await expect(ledger.commit({ requestId: "poor", amount: 9_000 })).rejects.toThrow(
      /meter/
    );
    balance = 1_000_000;
  });
});
