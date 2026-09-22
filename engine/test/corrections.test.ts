import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../src/common/store.js";
import { ValenceEngine } from "../src/engine/offers.js";
import { InMemoryLedger } from "../src/engine/ledger.js";
import { generateKeyPairSync, sign } from "node:crypto";
import { createApp } from "../src/http.js";
import { ApprovalDesk } from "../src/hub/approval.js";
import { RecoveryRegister } from "../src/hub/node.js";
import { PermissionLedger } from "../src/hub/permissions.js";
import { Registry } from "../src/shared/registry.js";
import { canonicalCorrection, type Correction } from "../src/shared/correction.js";
import { CONFIG_VERSION, HOUR, HOUSEHOLD, MANDATE, MERCHANT_PAIR, decideSigned, makeEngine } from "./helpers.js";

/**
 * §6.6, question 70, decided 2026-09-22. A refund or a corrected collection
 * reaches a signed settlement as a correction appended beside it, signed by
 * the merchant. The settlement is never rewritten, and the household's
 * receipt shows the original, each correction and the net.
 */
async function settled(store?: ReturnType<typeof openStore>) {
  const made = makeEngine({}, store);
  const { engine } = made;
  const offer = engine.createOffer({
    binding: "digital", household: HOUSEHOLD, purpose: "replenish", config_version: CONFIG_VERSION,
    expires_at: Date.now() + HOUR, mandate: MANDATE, price_band: null, giver: null,
    candidates: [{ product: "tea-a", quantity: 1, predicted_conversion: 0.5, is_exploration: true, given_by: null }],
  } as never);
  await engine.present(offer.id);
  await decideSigned(engine, offer.id, offer.candidates.map((c) => ({ candidate: c.id, valence: "kept" as const, kept_as: "self" as const })));
  const settlement = await engine.settle(offer.id);
  const handle = createApp(engine, {
    deliveries: made.deliveries, approvals: new ApprovalDesk(), recovery: new RecoveryRegister(),
    permissions: new PermissionLedger(), registry: new Registry(),
  });
  return { engine, offer, settlement, handle };
}

function signed(fields: Omit<Correction, "signature">, key = MERCHANT_PAIR.privateKey): Correction {
  return { ...fields, signature: sign(null, canonicalCorrection(fields), key).toString("base64") };
}

const post = (handle: (r: Request) => Promise<Response>, offer: string, body: unknown) =>
  handle(new Request(`https://unit.example/offers/${offer}/corrections`, { method: "POST", body: JSON.stringify(body) }));
const read = async (handle: (r: Request) => Promise<Response>, offer: string) =>
  (await (await handle(new Request(`https://unit.example/offers/${offer}/corrections`))).json()) as {
    original: { charged: number; carriage: number | null }; corrections: Correction[]; net: number;
  };

describe("§6.6, question 70: a correction is appended and the settlement is never rewritten", () => {
  test("a merchant-signed refund is appended, and the receipt shows the original, the correction and the net", async () => {
    const { offer, settlement, handle, engine } = await settled();
    const before = structuredClone(engine.settlement(offer.id));
    const c = signed({ id: "r-1", offer: offer.id, merchant: "maker-a", amount: 500, kind: "refund", note: "damaged in transit", corrected_at: settlement.settled_at + 1 });
    const { signature: _, offer: __, ...body } = c;
    const r = await post(handle, offer.id, { ...body, signature: c.signature });
    expect(r.status).toBe(201);
    // NOTE (mutation check, 2026-09-22): correction_rewrites_settlement.
    expect(engine.settlement(offer.id)).toEqual(before!);
    const receipt = await read(handle, offer.id);
    expect(receipt.original.charged).toBe(settlement.charged);
    expect(receipt.corrections).toEqual([c]);
    expect(receipt.net).toBe(settlement.charged - 500);
  });

  test("the same correction sent twice is one correction, and the same id with other content is refused", async () => {
    // NOTE (mutation check, 2026-09-22): correction_retry_appends_twice.
    const { offer, settlement, handle } = await settled();
    const c = signed({ id: "r-1", offer: offer.id, merchant: "maker-a", amount: 300, kind: "refund", note: "", corrected_at: settlement.settled_at });
    const { offer: _, ...body } = c;
    expect((await post(handle, offer.id, body)).status).toBe(201);
    expect((await post(handle, offer.id, body)).status).toBe(200);
    expect((await read(handle, offer.id)).net).toBe(settlement.charged - 300);
    const other = signed({ ...c, amount: 301 });
    const { offer: __, ...otherBody } = other;
    const r = await post(handle, offer.id, otherBody);
    expect(r.status).toBe(409);
    expect(((await r.json()) as { error: string }).error).toBe("correction_conflict");
  });

  test("corrections together cannot lower more than the merchant was paid", async () => {
    // NOTE (mutation check, 2026-09-22): correction_ceiling_unchecked.
    const { offer, settlement, handle } = await settled();
    const whole = signed({ id: "r-1", offer: offer.id, merchant: "maker-a", amount: settlement.charged, kind: "refund", note: "", corrected_at: settlement.settled_at });
    const { offer: _, ...wholeBody } = whole;
    expect((await post(handle, offer.id, wholeBody)).status).toBe(201);
    const more = signed({ id: "r-2", offer: offer.id, merchant: "maker-a", amount: 1, kind: "refund", note: "", corrected_at: settlement.settled_at });
    const { offer: __, ...moreBody } = more;
    const r = await post(handle, offer.id, moreBody);
    expect(r.status).toBe(422);
    expect(((await r.json()) as { error: string }).error).toBe("correction_exceeds_charge");
    expect((await read(handle, offer.id)).net).toBe(0);
  });

  test("a correction not signed by the merchant of record is refused", async () => {
    // NOTE (mutation check, 2026-09-22): correction_signature_unchecked.
    const { offer, settlement, handle, engine } = await settled();
    const stranger = generateKeyPairSync("ed25519");
    const forged = signed({ id: "r-1", offer: offer.id, merchant: "maker-a", amount: 100, kind: "refund", note: "", corrected_at: settlement.settled_at }, stranger.privateKey);
    const { offer: _, ...body } = forged;
    const r = await post(handle, offer.id, body);
    expect(r.status).toBe(422);
    expect(((await r.json()) as { error: string }).error).toBe("bad_signature");
    expect(engine.correctionsFor(offer.id)).toEqual([]);
  });

  test("only a merchant the household paid can append one", async () => {
    // NOTE (mutation check, 2026-09-22): correction_any_merchant.
    const { offer, settlement, handle, engine } = await settled();
    const other = generateKeyPairSync("ed25519");
    engine.registerIdentity("maker-z", other.publicKey.export({ type: "spki", format: "pem" }).toString());
    const c = signed({ id: "r-1", offer: offer.id, merchant: "maker-z", amount: 100, kind: "refund", note: "", corrected_at: settlement.settled_at }, other.privateKey);
    const { offer: _, ...body } = c;
    const r = await post(handle, offer.id, body);
    expect(r.status).toBe(422);
    expect(((await r.json()) as { error: string }).error).toBe("not_merchant_of_record");
  });

  test("an offer with no settlement has nothing to correct, and malformed bodies are refused", async () => {
    const { offer, settlement, handle } = await settled();
    expect((await post(handle, "no-such-offer", {})).status).toBe(404);
    const c = signed({ id: "r-1", offer: offer.id, merchant: "maker-a", amount: 100, kind: "refund", note: "", corrected_at: settlement.settled_at });
    const { offer: _, ...body } = c;
    for (const bad of [{ ...body, amount: 0 }, { ...body, amount: -5 }, { ...body, kind: "raise" }, { ...body, extra: 1 }, { ...body, note: "x".repeat(501) }]) {
      expect((await post(handle, offer.id, bad)).status).toBe(400);
    }
    const early = signed({ ...c, corrected_at: settlement.settled_at - 1 });
    const { offer: __, ...earlyBody } = early;
    expect((await post(handle, offer.id, earlyBody)).status).toBe(422);
  });

  test("the signed form is bound to the offer, so a correction cannot be re-filed under another", async () => {
    const { offer, settlement, handle } = await settled();
    const second = await settled();
    const c = signed({ id: "r-1", offer: offer.id, merchant: "maker-a", amount: 100, kind: "refund", note: "", corrected_at: settlement.settled_at });
    const { offer: _, ...body } = c;
    // The second engine registered the same merchant key, so only the offer
    // in the signed bytes stops this.
    const r = await post(second.handle, second.offer.id, body);
    expect(r.status).toBe(422);
    expect(((await r.json()) as { error: string }).error).toBe("bad_signature");
  });

  test("a correction survives a restart, because it is the household's record", async () => {
    // A map writes through on `set`, and the engine writes a new array rather
    // than pushing into the one it read, which is what this proves.
    const dir = mkdtempSync(join(tmpdir(), "valence-corrections-"));
    try {
      const path = join(dir, "store.sqlite");
      const store = openStore(path);
      const { offer, settlement, engine } = await settled(store);
      const c = signed({ id: "r-1", offer: offer.id, merchant: "maker-a", amount: 200, kind: "collection", note: "one item came back", corrected_at: settlement.settled_at });
      engine.appendCorrection(c, null);
      store.close();
      const reopened = openStore(path);
      try {
        const again = new ValenceEngine(new InMemoryLedger(reopened), { explorationRate: 0.2, reminderLimit: 1, recoveryGraceDays: 3, relyingPartyId: "unit.example" }, reopened);
        expect(again.correctionsFor(offer.id)).toEqual([c]);
      } finally {
        reopened.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

});

describe("§6.6, §14.2, question 70: corrections move with the household", () => {
  async function exported() {
    const a = await settled();
    const c = signed({ id: "r-1", offer: a.offer.id, merchant: "maker-a", amount: 400, kind: "refund", note: "one pack damaged", corrected_at: a.settlement.settled_at });
    a.engine.appendCorrection(c, null);
    const node = (await (await a.handle(new Request(`https://unit.example/households/${encodeURIComponent(HOUSEHOLD)}/export`))).json()) as Record<string, any>;
    return { a, c, node };
  }
  const importInto = (handle: (r: Request) => Promise<Response>, node: unknown) =>
    handle(new Request(`https://unit.example/households/${encodeURIComponent(HOUSEHOLD)}/import`, { method: "POST", body: JSON.stringify(node) }));
  function freshHost() {
    const made = makeEngine();
    const handle = createApp(made.engine, {
      deliveries: made.deliveries, approvals: new ApprovalDesk(), recovery: new RecoveryRegister(),
      permissions: new PermissionLedger(), registry: new Registry(),
    });
    return { engine: made.engine, handle };
  }

  test("the export carries them, and the next host holds them exactly", async () => {
    // NOTE (mutation check, 2026-09-22): export_drops_corrections and
    // import_drops_corrections.
    const { a, c, node } = await exported();
    expect(node.format).toBe("valence-node/11");
    expect(node.corrections).toEqual({ [a.offer.id]: [c] });
    const b = freshHost();
    const r = await importInto(b.handle, node);
    expect(r.status).toBe(201);
    expect(b.engine.correctionsFor(a.offer.id)).toEqual([c]);
  });

  test("a correction altered on the way is refused and nothing is written", async () => {
    // NOTE (mutation check, 2026-09-22): import_correction_unchecked.
    const { a, node } = await exported();
    node.corrections[a.offer.id][0].amount = node.settlements[0].charged;
    const b = freshHost();
    const r = await importInto(b.handle, node);
    expect(r.status).toBe(422);
    expect(((await r.json()) as { error: string }).error).toBe("bad_signature");
    expect(b.engine.correctionsFor(a.offer.id)).toEqual([]);
    expect(b.engine.settlement(a.offer.id)).toBeUndefined();
  });

  test("a correction for an offer the body does not carry is refused", async () => {
    // NOTE (mutation check, 2026-09-22): import_corrections_unscoped.
    const { a, node } = await exported();
    const b = freshHost();
    const r = await importInto(b.handle, { ...node, offers: [], settlements: [], collections: [], deliveries: [], notes: [], confirmations: {}, decided_protections: {}, carriage_quotes: [] });
    expect(r.status).toBe(422);
    expect(((await r.json()) as { error: string }).error).toBe("unscoped_correction");
    expect(b.engine.correctionsFor(a.offer.id)).toEqual([]);
  });

  test("an offer already here takes no correction it does not hold, and the same body again changes nothing", async () => {
    // NOTE (mutation check, 2026-09-22): carried_corrections_not_compared.
    const { a, c, node } = await exported();
    const b = freshHost();
    expect((await importInto(b.handle, node)).status).toBe(201);
    expect((await importInto(b.handle, node)).status).toBe(201);
    expect(b.engine.correctionsFor(a.offer.id)).toEqual([c]);
    const more = signed({ id: "r-2", offer: a.offer.id, merchant: "maker-a", amount: 1, kind: "refund", note: "", corrected_at: a.settlement.settled_at });
    const r = await importInto(b.handle, { ...node, corrections: { [a.offer.id]: [c, more] } });
    expect(r.status).toBe(409);
    expect(b.engine.correctionsFor(a.offer.id)).toEqual([c]);
  });

  test("an archive from before question 70 still moves, and a current one without the field does not", async () => {
    const { a, node } = await exported();
    const { corrections: _, ...rest } = node;
    expect((await importInto(freshHost().handle, rest)).status).toBe(400);
    expect((await importInto(freshHost().handle, { ...rest, format: "valence-node/9" })).status).toBe(201);
    expect(a.engine.correctionsFor(a.offer.id).length).toBe(1);
  });
});

