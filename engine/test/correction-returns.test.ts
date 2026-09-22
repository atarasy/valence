import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync, sign } from "node:crypto";
import { openStore } from "../src/common/store.js";
import { ValenceEngine } from "../src/engine/offers.js";
import { InMemoryLedger } from "../src/engine/ledger.js";
import { createApp } from "../src/http.js";
import { ApprovalDesk } from "../src/hub/approval.js";
import { RecoveryRegister } from "../src/hub/node.js";
import { PermissionLedger } from "../src/hub/permissions.js";
import { Registry } from "../src/shared/registry.js";
import { canonicalCorrection, type Correction } from "../src/shared/correction.js";
import { canonicalCorrectionReturn, type CorrectionReturn } from "../src/shared/correction-return.js";
import { CONFIG_VERSION, HOUR, HOUSEHOLD, MANDATE, MERCHANT_PAIR, decideSigned, makeEngine } from "./helpers.js";

/**
 * §6.6a, decided 2026-09-23. A refund recorded as a correction can come back
 * from the card issuer. The merchant appends a signed record that it did, and
 * later one that it was repaid another way. Neither moves money and neither
 * changes the net; the receipt gains `returns` and `owed` only once there is
 * a record, because clients read its keys exactly.
 */
type Handle = (r: Request) => Promise<Response>;

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
  const handle: Handle = createApp(engine, {
    deliveries: made.deliveries, approvals: new ApprovalDesk(), recovery: new RecoveryRegister(),
    permissions: new PermissionLedger(), registry: new Registry(),
  });
  const refund = correction({ id: "r-1", offer: offer.id, merchant: "maker-a", amount: 500, kind: "refund", note: "damaged", corrected_at: settlement.settled_at + 10 });
  engine.appendCorrection(refund, null);
  return { engine, offer, settlement, handle, refund };
}

function correction(fields: Omit<Correction, "signature">, key = MERCHANT_PAIR.privateKey): Correction {
  return { ...fields, signature: sign(null, canonicalCorrection(fields), key).toString("base64") };
}

function record(fields: Omit<CorrectionReturn, "signature">, key = MERCHANT_PAIR.privateKey): CorrectionReturn {
  return { ...fields, signature: sign(null, canonicalCorrectionReturn(fields), key).toString("base64") };
}

const bodyOf = ({ offer: _, ...rest }: CorrectionReturn | Record<string, unknown>) => rest;
const post = (handle: Handle, offer: string, body: unknown) =>
  handle(new Request(`https://unit.example/offers/${offer}/returns`, { method: "POST", body: JSON.stringify(body) }));
const receipt = async (handle: Handle, offer: string) =>
  (await (await handle(new Request(`https://unit.example/offers/${offer}/corrections`))).json()) as Record<string, any>;
const errorOf = async (r: Response) => ((await r.json()) as { error: string }).error;

describe("§6.6a: a returned refund is recorded beside its correction", () => {
  test("the receipt carries no returns key until one is held, then returns and owed, and the net does not move", async () => {
    const { offer, settlement, handle, refund, engine } = await settled();
    const before = await receipt(handle, offer.id);
    expect(Object.keys(before).sort()).toEqual(["corrections", "net", "offer", "original"]);
    const settledBefore = structuredClone(engine.settlement(offer.id));
    const returned = record({ correction: refund.id, offer: offer.id, merchant: "maker-a", state: "returned", note: "the issuer sent it back", at: refund.corrected_at + 5 });
    const r = await post(handle, offer.id, bodyOf(returned));
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual(returned);
    const after = await receipt(handle, offer.id);
    expect(after.returns).toEqual([returned]);
    expect(after.owed).toBe(500);
    expect(after.net).toBe(before.net);
    expect(after.net).toBe(settlement.charged - 500);
    expect(engine.settlement(offer.id)).toEqual(settledBefore!);
  });

  test("a repayment clears what is owed, and the records read oldest first", async () => {
    const { offer, handle, refund } = await settled();
    const returned = record({ correction: refund.id, offer: offer.id, merchant: "maker-a", state: "returned", note: "", at: refund.corrected_at + 5 });
    const repaid = record({ correction: refund.id, offer: offer.id, merchant: "maker-a", state: "repaid", note: "paid by bank transfer", at: refund.corrected_at + 9 });
    expect((await post(handle, offer.id, bodyOf(returned))).status).toBe(201);
    expect((await post(handle, offer.id, bodyOf(repaid))).status).toBe(201);
    const after = await receipt(handle, offer.id);
    expect(after.returns).toEqual([returned, repaid]);
    expect(after.owed).toBe(0);
  });

  test("records of two corrections are sorted by when, not by arrival", async () => {
    const { offer, handle, refund, engine, settlement } = await settled();
    const second = correction({ id: "r-2", offer: offer.id, merchant: "maker-a", amount: 100, kind: "refund", note: "", corrected_at: settlement.settled_at });
    engine.appendCorrection(second, null);
    const late = record({ correction: refund.id, offer: offer.id, merchant: "maker-a", state: "returned", note: "", at: refund.corrected_at + 100 });
    const early = record({ correction: "r-2", offer: offer.id, merchant: "maker-a", state: "returned", note: "", at: refund.corrected_at + 1 });
    expect((await post(handle, offer.id, bodyOf(late))).status).toBe(201);
    expect((await post(handle, offer.id, bodyOf(early))).status).toBe(201);
    const after = await receipt(handle, offer.id);
    expect(after.returns).toEqual([early, late]);
    expect(after.owed).toBe(600);
  });

  test("the same record twice is one record, and the same correction and state with anything different is refused", async () => {
    const { offer, handle, refund } = await settled();
    const returned = record({ correction: refund.id, offer: offer.id, merchant: "maker-a", state: "returned", note: "", at: refund.corrected_at });
    expect((await post(handle, offer.id, bodyOf(returned))).status).toBe(201);
    const again = await post(handle, offer.id, bodyOf(returned));
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(returned);
    const other = record({ ...bodyOf(returned), offer: offer.id, note: "changed" } as Omit<CorrectionReturn, "signature">);
    const r = await post(handle, offer.id, bodyOf(other));
    expect(r.status).toBe(409);
    expect(await errorOf(r)).toBe("return_conflict");
    expect((await receipt(handle, offer.id)).returns).toEqual([returned]);
  });

  test("a repayment needs a return first, and neither may predate what it follows", async () => {
    const { offer, handle, refund } = await settled();
    const repaid = record({ correction: refund.id, offer: offer.id, merchant: "maker-a", state: "repaid", note: "", at: refund.corrected_at + 5 });
    const early = await post(handle, offer.id, bodyOf(repaid));
    expect(early.status).toBe(409);
    expect(await errorOf(early)).toBe("not_returned");
    const tooSoon = record({ correction: refund.id, offer: offer.id, merchant: "maker-a", state: "returned", note: "", at: refund.corrected_at - 1 });
    const r = await post(handle, offer.id, bodyOf(tooSoon));
    expect(r.status).toBe(422);
    expect(await errorOf(r)).toBe("return_before_correction");
    const returned = record({ correction: refund.id, offer: offer.id, merchant: "maker-a", state: "returned", note: "", at: refund.corrected_at + 10 });
    expect((await post(handle, offer.id, bodyOf(returned))).status).toBe(201);
    const backwards = await post(handle, offer.id, bodyOf(repaid));
    expect(backwards.status).toBe(422);
    expect(await errorOf(backwards)).toBe("return_before_correction");
    expect((await receipt(handle, offer.id)).owed).toBe(500);
  });

  test("only a refund, only its own merchant, only its own signature", async () => {
    const { offer, handle, refund, engine, settlement } = await settled();
    const collected = correction({ id: "c-1", offer: offer.id, merchant: "maker-a", amount: 1, kind: "collection", note: "", corrected_at: settlement.settled_at });
    engine.appendCorrection(collected, null);
    const onCollection = await post(handle, offer.id, bodyOf(record({ correction: "c-1", offer: offer.id, merchant: "maker-a", state: "returned", note: "", at: refund.corrected_at })));
    expect(onCollection.status).toBe(422);
    expect(await errorOf(onCollection)).toBe("not_a_refund");

    const other = generateKeyPairSync("ed25519");
    engine.registerIdentity("maker-z", other.publicKey.export({ type: "spki", format: "pem" }).toString());
    const stranger = await post(handle, offer.id, bodyOf(record({ correction: refund.id, offer: offer.id, merchant: "maker-z", state: "returned", note: "", at: refund.corrected_at }, other.privateKey)));
    expect(stranger.status).toBe(422);
    expect(await errorOf(stranger)).toBe("not_merchant_of_record");

    const forged = await post(handle, offer.id, bodyOf(record({ correction: refund.id, offer: offer.id, merchant: "maker-a", state: "returned", note: "", at: refund.corrected_at }, other.privateKey)));
    expect(forged.status).toBe(422);
    expect(await errorOf(forged)).toBe("bad_signature");
    expect(engine.returnsFor(offer.id)).toEqual([]);
  });

  test("a record signed for one offer does not verify under another", async () => {
    const a = await settled();
    const b = await settled();
    const returned = record({ correction: a.refund.id, offer: a.offer.id, merchant: "maker-a", state: "returned", note: "", at: a.refund.corrected_at + b.refund.corrected_at });
    const r = await post(b.handle, b.offer.id, bodyOf(returned));
    expect(r.status).toBe(422);
    expect(await errorOf(r)).toBe("bad_signature");
  });

  test("an unknown offer, an unknown correction and a malformed body are refused", async () => {
    const { offer, handle, refund } = await settled();
    const good = record({ correction: refund.id, offer: offer.id, merchant: "maker-a", state: "returned", note: "", at: refund.corrected_at });
    const missing = await post(handle, "no-such-offer", bodyOf(good));
    expect(missing.status).toBe(404);
    expect(await errorOf(missing)).toBe("not_found");
    const unknown = await post(handle, offer.id, { ...bodyOf(good), correction: "r-404" });
    expect(unknown.status).toBe(404);
    expect(await errorOf(unknown)).toBe("unknown_correction");
    const body = bodyOf(good);
    for (const bad of [
      { ...body, state: "reversed" }, { ...body, note: "x".repeat(501) }, { ...body, at: -1 }, { ...body, at: 1.5 },
      { ...body, at: 2 ** 53 }, { ...body, extra: 1 }, { ...body, correction: "" }, { ...body, offer: offer.id },
    ]) {
      const r = await post(handle, offer.id, bad);
      expect(r.status).toBe(400);
      expect(await errorOf(r)).toBe("malformed");
    }
  });

  test("records survive a restart, because they are the household's receipt", async () => {
    // A map writes through on `set`, and the engine writes a new array rather
    // than pushing into the one it read; the repayment proves the second write.
    const dir = mkdtempSync(join(tmpdir(), "valence-returns-"));
    try {
      const path = join(dir, "store.sqlite");
      const store = openStore(path);
      const { offer, refund, engine } = await settled(store);
      const returned = record({ correction: refund.id, offer: offer.id, merchant: "maker-a", state: "returned", note: "", at: refund.corrected_at });
      const repaid = record({ correction: refund.id, offer: offer.id, merchant: "maker-a", state: "repaid", note: "cash", at: refund.corrected_at + 1 });
      engine.appendReturn(returned);
      engine.appendReturn(repaid);
      store.close();
      const reopened = openStore(path);
      try {
        const again = new ValenceEngine(new InMemoryLedger(reopened), { explorationRate: 0.2, reminderLimit: 1, recoveryGraceDays: 3, relyingPartyId: "unit.example" }, reopened);
        expect(again.returnsFor(offer.id)).toEqual([returned, repaid]);
        expect(again.deleteOfferRecord(offer.id).correction_returns).toBe(1);
        expect(again.returnsFor(offer.id)).toEqual([]);
      } finally {
        reopened.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a household's deletion takes the records with the corrections", async () => {
    const { offer, refund, engine } = await settled();
    engine.appendReturn(record({ correction: refund.id, offer: offer.id, merchant: "maker-a", state: "returned", note: "", at: refund.corrected_at }));
    const counts = engine.deleteOfferRecord(offer.id);
    expect(counts.corrections).toBe(1);
    expect(counts.correction_returns).toBe(1);
    expect(engine.returnsFor(offer.id)).toEqual([]);
  });
});

describe("§6.6a, §14.2: the records move with the household", () => {
  async function exported() {
    const a = await settled();
    const returned = record({ correction: a.refund.id, offer: a.offer.id, merchant: "maker-a", state: "returned", note: "sent back", at: a.refund.corrected_at + 1 });
    a.engine.appendReturn(returned);
    const node = (await (await a.handle(new Request(`https://unit.example/households/${encodeURIComponent(HOUSEHOLD)}/export`))).json()) as Record<string, any>;
    return { a, returned, node };
  }
  const importInto = (handle: Handle, node: unknown) =>
    handle(new Request(`https://unit.example/households/${encodeURIComponent(HOUSEHOLD)}/import`, { method: "POST", body: JSON.stringify(node) }));
  function freshHost() {
    const made = makeEngine();
    const handle: Handle = createApp(made.engine, {
      deliveries: made.deliveries, approvals: new ApprovalDesk(), recovery: new RecoveryRegister(),
      permissions: new PermissionLedger(), registry: new Registry(),
    });
    return { engine: made.engine, handle };
  }

  test("the export carries them in valence-node/12, and the next host answers the same receipt", async () => {
    const { a, returned, node } = await exported();
    expect(node.format).toBe("valence-node/12");
    expect(node.correction_returns).toEqual({ [a.offer.id]: [returned] });
    const b = freshHost();
    expect((await importInto(b.handle, node)).status).toBe(201);
    expect(b.engine.returnsFor(a.offer.id)).toEqual([returned]);
    expect(await receipt(b.handle, a.offer.id)).toEqual(await receipt(a.handle, a.offer.id));
  });

  test("an export with no records carries an empty map, and one without the field is refused", async () => {
    const a = await settled();
    const node = (await (await a.handle(new Request(`https://unit.example/households/${encodeURIComponent(HOUSEHOLD)}/export`))).json()) as Record<string, any>;
    expect(node.correction_returns).toEqual({});
    const { correction_returns: _, ...rest } = node;
    const r = await importInto(freshHost().handle, rest);
    expect(r.status).toBe(400);
    for (const format of ["valence-node/11", "valence-node/10"]) {
      const b = freshHost();
      expect((await importInto(b.handle, { ...rest, format })).status).toBe(201);
      expect(b.engine.correctionsFor(a.offer.id)).toEqual([a.refund]);
    }
  });

  test("a record altered on the way is refused and nothing is written", async () => {
    const { a, node } = await exported();
    node.correction_returns[a.offer.id][0].note = "never returned";
    const b = freshHost();
    const r = await importInto(b.handle, node);
    expect(r.status).toBe(422);
    expect(await errorOf(r)).toBe("bad_signature");
    expect(b.engine.returnsFor(a.offer.id)).toEqual([]);
    expect(b.engine.settlement(a.offer.id)).toBeUndefined();
  });

  test("a record naming an offer or a correction the body does not carry is refused", async () => {
    const { a, node } = await exported();
    const noOffer = await importInto(freshHost().handle, { ...node, offers: [], settlements: [], collections: [], deliveries: [], notes: [], confirmations: {}, decided_protections: {}, carriage_quotes: [], corrections: {} });
    expect(noOffer.status).toBe(422);
    expect(await errorOf(noOffer)).toBe("unscoped_return");
    const b = freshHost();
    const noCorrection = await importInto(b.handle, { ...node, corrections: {} });
    expect(noCorrection.status).toBe(422);
    expect(await errorOf(noCorrection)).toBe("unscoped_return");
    expect(b.engine.settlement(a.offer.id)).toBeUndefined();
  });

  test("an offer already here takes no record it does not hold, and the same body again changes nothing", async () => {
    const { a, returned, node } = await exported();
    const b = freshHost();
    expect((await importInto(b.handle, node)).status).toBe(201);
    expect((await importInto(b.handle, node)).status).toBe(201);
    expect(b.engine.returnsFor(a.offer.id)).toEqual([returned]);
    const repaid = record({ correction: a.refund.id, offer: a.offer.id, merchant: "maker-a", state: "repaid", note: "", at: returned.at });
    const r = await importInto(b.handle, { ...node, correction_returns: { [a.offer.id]: [returned, repaid] } });
    expect(r.status).toBe(409);
    expect(b.engine.returnsFor(a.offer.id)).toEqual([returned]);
  });

  test("a repayment carried without its return is refused, as the route refuses it", async () => {
    const { a, node } = await exported();
    const repaid = record({ correction: a.refund.id, offer: a.offer.id, merchant: "maker-a", state: "repaid", note: "", at: a.refund.corrected_at + 2 });
    const b = freshHost();
    const r = await importInto(b.handle, { ...node, correction_returns: { [a.offer.id]: [repaid] } });
    expect(r.status).toBe(409);
    expect(await errorOf(r)).toBe("not_returned");
    expect(b.engine.settlement(a.offer.id)).toBeUndefined();
  });
});
