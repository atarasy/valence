import { describe, expect, test } from "bun:test";
import { inMemoryStore } from "../src/common/store.js";
import { RemoteDay } from "../src/engine/day-source.js";
import { ValenceEngine } from "../src/engine/offers.js";
import { InMemoryLedger } from "../src/engine/ledger.js";
import { createApp } from "../src/http.js";
import { ApprovalDesk } from "../src/hub/approval.js";
import { DeliveryRegister } from "../src/hub/delivery.js";
import { RecoveryRegister } from "../src/hub/node.js";
import { PermissionLedger } from "../src/hub/permissions.js";
import { Registry } from "../src/shared/registry.js";
import { houseFor } from "./helpers.js";

const HOME = houseFor("report-credential").household;
const TOKEN = "t".repeat(64);

/**
 * §16.3, question 67, decided 2026-09-22. The hub takes a settlement or a
 * decided offer from the engine only. Before this, `POST /households/{id}/settled`
 * took any row from any caller, so a stranger could fill a household's day and
 * the daily ceiling protected nothing.
 */
function hub(reportCredential?: string) {
  const store = inMemoryStore();
  const engine = new ValenceEngine(new InMemoryLedger(), {
    explorationRate: 0.2, reminderLimit: 1, recoveryGraceDays: 3, relyingPartyId: "unit.example",
  }, store);
  const handle = createApp(engine, {
    reportCredential,
    deliveries: new DeliveryRegister(store), approvals: new ApprovalDesk(store), recovery: new RecoveryRegister(store),
    permissions: new PermissionLedger(store), registry: new Registry(store),
  });
  const settle = (authorization?: string) =>
    handle(new Request(`https://unit.example/households/${HOME}/settled`, {
      method: "POST",
      headers: authorization ? { authorization } : {},
      body: JSON.stringify({ offer: "o1", household: HOME, amount: 900, settled_at: 10 }),
    }));
  const offer = (authorization?: string) =>
    handle(new Request(`https://unit.example/households/${HOME}/offers`, {
      method: "POST",
      headers: authorization ? { authorization } : {},
      body: JSON.stringify({ id: "o1", household: HOME, presenter: "p", recorded_at: 10, offer: {} }),
    }));
  return { engine, settle, offer };
}

describe("§16.3, question 67: only the engine reports to the person's day", () => {
  test("a settlement with no credential is refused and not counted", async () => {
    // NOTE (mutation check, 2026-09-22): settled_report_unauthenticated.
    const h = hub(TOKEN);
    const r = await h.settle();
    expect(r.status).toBe(401);
    expect(((await r.json()) as { error: string }).error).toBe("unauthenticated_report");
    expect(h.engine.householdLedger.totalSince(HOME, 0)).toBe(0);
  });

  test("a settlement under another credential is refused", async () => {
    // NOTE (mutation check, 2026-09-22): report_credential_any_bearer.
    const h = hub(TOKEN);
    expect((await h.settle(`Bearer ${"u".repeat(64)}`)).status).toBe(401);
    expect((await h.settle(TOKEN)).status).toBe(401);
    expect(h.engine.householdLedger.totalSince(HOME, 0)).toBe(0);
  });

  test("the engine's credential is taken", async () => {
    const h = hub(TOKEN);
    expect((await h.settle(`Bearer ${TOKEN}`)).status).toBeLessThan(300);
    expect(h.engine.householdLedger.totalSince(HOME, 0)).toBe(900);
  });

  test("a hub with no credential takes no report at all", async () => {
    // One process presenting both roles writes the ledger in-process, so
    // nothing needs this route; an unset credential must not mean "anyone".
    const h = hub(undefined);
    expect((await h.settle()).status).toBe(401);
    expect((await h.settle("Bearer ")).status).toBe(401);
    expect((await h.settle("Bearer undefined")).status).toBe(401);
  });

  test("a decided offer is reported under the same rule", async () => {
    // NOTE (mutation check, 2026-09-22): offer_report_unauthenticated.
    const h = hub(TOKEN);
    const r = await h.offer();
    expect(r.status).toBe(401);
    expect(((await r.json()) as { error: string }).error).toBe("unauthenticated_report");
  });
});

describe("§16.3, question 67: the remote day presents the credential", () => {
  test("both writes carry it and the read does not", async () => {
    // NOTE (mutation check, 2026-09-22): remote_day_omits_credential.
    const seen: Array<{ method: string; authorization: string | null }> = [];
    const day = new RemoteDay("http://hub.example", (async (_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seen.push({ method: init?.method ?? "GET", authorization: headers.get("authorization") });
      return new Response(JSON.stringify({ total: 0 }), { status: 200 });
    }) as never, TOKEN);
    await day.report({ offer: "o1", household: "h", amount: 1, settled_at: 1 });
    await day.reportOffer({ id: "o1", household: "h", presenter: "p", recorded_at: 1, offer: {} });
    await day.totalSince("h", 0);
    expect(seen).toEqual([
      { method: "POST", authorization: `Bearer ${TOKEN}` },
      { method: "POST", authorization: `Bearer ${TOKEN}` },
      { method: "GET", authorization: null },
    ]);
  });
});
