import { describe, expect, test } from "bun:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { CONFIG_VERSION, HOUR, HOUSEHOLD, MANDATE, MANDATE_PAIR, MERCHANT_PAIR, PHYSICAL, decideSigned, disclosureFor, makeEngine, settleSigned, signConfig, GIFT_GIVER, presentGift } from "./helpers.js";
import { canonicalStatement, statementLines } from "../src/shared/statement.js";
import { canonicalConfig } from "../src/engine/offers.js";
import { canonicalDecisions } from "../src/shared/decisions.js";
import { canonicalDisclosure, verifyDisclosure } from "../src/shared/disclosure.js";

/**
 * §6.5 and §11.2. Question 36, decided 2026-09-12.
 *
 * The collection records what was used and the household may not name that
 * verdict itself; until this file existed the reference then charged those
 * lines on the collection's record alone. The collection's record is a
 * proposal, the household's signature over the statement is the application,
 * a disputed line leaves the rail, and the next box does not come while a
 * statement stands unsigned.
 */
const physical = (household: string, products: { product: string; given_by?: string }[]) => ({
  binding: "physical" as const,
  household,
  purpose: "replenish" as const,
  config_version: CONFIG_VERSION,
  expires_at: Date.now() + HOUR,
  mandate: MANDATE,
  price_band: null,
  giver: null,
  candidates: products.map((c, i) => ({
    product: c.product,
    quantity: 1,
    predicted_conversion: 0.5,
    is_exploration: i === 0,
    given_by: c.given_by ?? null,
  })),
});

/**
 * A box whose collection recorded goods used and which is back in
 * `presented`: the household kept one line, the route resolved the rest, and
 * the household took its line back inside a cooling window of an hour.
 */
async function collected(
  made: ReturnType<typeof makeEngine>,
  household = HOUSEHOLD
) {
  const { engine, deliveries } = made;
  const offer = engine.createOffer(physical(household, [{ product: "coffee-a" }, { product: "tea-b" }, { product: "miso-a" }]));
  await engine.present(offer.id);
  // §6.5, 法11条1号. A box that was delivered and collected has a delivery
  // record, and the statement renders the carriage from it. A merchant whose
  // price includes carriage records 0; `null` is an implementation that never
  // recorded what it did, and `settle` refuses it.
  deliveries.record({ offer: offer.id, carriage: 550, code: `dc-${offer.id.slice(0, 8)}`, status: "delivered" });
  engine.collect({
    offer: offer.id,
    returned: [offer.candidates[2]!.id],
    consumed: [offer.candidates[0]!.id, offer.candidates[1]!.id],
    at: Date.now(),
  });
  engine.applyRecoveryTo(offer.id);
  return offer;
}

describe("§6.5: a physical box with goods used settles on the household's signature", () => {
  test("an empty settle is refused, and names itself", async () => {
    const made = makeEngine();
    const { engine } = made;
    const offer = await collected(made);
    await expect(engine.settle(offer.id)).rejects.toMatchObject({ code: "statement_unsigned" });
    expect(engine.settlement(offer.id)).toBeUndefined();
  });

  test("a signature by another key, or over other lines, is refused", async () => {
    const made = makeEngine();
    const { engine } = made;
    const offer = await collected(made);
    const lines = statementLines(offer, []);
    const stranger = generateKeyPairSync("ed25519");
    const forged = sign(null, canonicalStatement(offer.id, 550, lines), stranger.privateKey).toString("base64");
    await expect(engine.settle(offer.id, Date.now(), { signed: { signature: forged } })).rejects.toMatchObject({ code: "bad_signature" });
    // The right key over a statement that disputes a line, sent without the
    // dispute: the bytes differ and the signature does not cover what is sent.
    const other = sign(null, canonicalStatement(offer.id, 550, statementLines(offer, [offer.candidates[0]!.id])), MANDATE_PAIR.privateKey).toString("base64");
    await expect(engine.settle(offer.id, Date.now(), { signed: { signature: other } })).rejects.toMatchObject({ code: "bad_signature" });
  });

  test("the signed statement settles, and the settlement carries it", async () => {
    const made = makeEngine();
    const { engine } = made;
    const offer = await collected(made);
    const settlement = await settleSigned(engine, offer.id);
    expect(settlement.consumed_amount).toBe(1500 + 900);
    expect(settlement.charged).toBe(1500 + 900);
    expect(settlement.disputed_amount).toBe(0);
    expect(typeof settlement.confirmation).toBe("string");
  });

  test("a disputed line leaves the rail: not charged, and shown as disputed", async () => {
    const made = makeEngine();
    const { engine } = made;
    const offer = await collected(made);
    const coffee = offer.candidates[0]!.id;
    const settlement = await settleSigned(engine, offer.id, [coffee]);
    expect(settlement.consumed_amount).toBe(900);
    expect(settlement.charged).toBe(900);
    expect(settlement.disputed_amount).toBe(1500);
    const line = settlement.lines.find((l) => l.candidate === coffee)!;
    expect(line.disputed).toBe(true);
    expect(line.amount).toBe(1500);
    expect(settlement.lines.find((l) => l.product === "tea-b")!.disputed).toBe(false);
  });

  test("only a consumed line can be disputed", async () => {
    const made = makeEngine();
    const { engine } = made;
    const offer = await collected(made);
    const returned = offer.candidates[2]!.id;
    await expect(settleSigned(engine, offer.id, [returned])).rejects.toMatchObject({ code: "not_disputable" });
  });

  test("the digital binding and a box with nothing used need no statement", async () => {
    const { engine } = makeEngine();
    const offer = engine.createOffer(physical(HOUSEHOLD, [{ product: "coffee-a" }, { product: "tea-b" }]));
    await engine.present(offer.id);
    engine.collect({ offer: offer.id, returned: offer.candidates.map((c) => c.id), consumed: [], at: Date.now() });
    engine.applyRecoveryTo(offer.id);
    const settlement = await engine.settle(offer.id);
    expect(settlement.charged).toBe(0);
    expect(settlement.confirmation).toBeNull();
  });

  test("the next box does not come while a statement stands unsigned", async () => {
    const made = makeEngine();
    const { engine } = made;
    const first = await collected(made, HOUSEHOLD);
    const second = engine.createOffer(physical(HOUSEHOLD, [{ product: "nori-a" }, { product: "coffee-a" }]));
    await expect(engine.present(second.id)).rejects.toMatchObject({ code: "statement_unsigned" });
    await settleSigned(engine, first.id);
    const presented = await engine.present(second.id);
    expect(presented.state).toBe("presented");
  });
});

describe("§10a.5: a block for one product", () => {
  test("the product is inside the signature", () => {
    const block = disclosureFor("maker-a", "tea-a");
    const pem = MERCHANT_PAIR.publicKey.export({ type: "spki", format: "pem" }).toString();
    expect(verifyDisclosure(block, pem)).toBe(true);
    expect(verifyDisclosure({ ...block, product: "tea-b" }, pem)).toBe(false);
    expect(verifyDisclosure({ ...block, product: null }, pem)).toBe(false);
    expect(canonicalDisclosure(block).equals(canonicalDisclosure({ ...block, product: null }))).toBe(false);
  });

  test("it travels only on an offer holding that product, beside the standing text", async () => {
    const { engine } = makeEngine();
    engine.putDisclosure(disclosureFor("maker-a", "tea-a"));
    const withTea = engine.createOffer(physical(HOUSEHOLD, [{ product: "tea-a" }, { product: "tea-b" }]));
    expect(withTea.disclosures.map((d) => d.product).sort()).toEqual([null, "tea-a"].sort());
    const without = engine.createOffer(physical(HOUSEHOLD, [{ product: "coffee-a" }, { product: "tea-b" }]));
    expect(without.disclosures.map((d) => d.product)).toEqual([null]);
  });

  test("it does not stand in for the merchant's standing text", async () => {
    const { engine } = makeEngine();
    engine.registerIdentity("maker-b", MERCHANT_PAIR.publicKey.export({ type: "spki", format: "pem" }).toString());
    const config = {
      version: "cfg-b",
      presenter: "merchant-1",
      products: {
        "salt-a": { merchant: "maker-b", maker: "made-by-salt", ships: "carrier-b", price: 500, physical: PHYSICAL },
      },
    };
    engine.registerConfig(config, signConfig(config));
    // Only a product block for maker-b. §10a.3 asks for the standing text,
    // and a block about one product is not it.
    engine.putDisclosure(disclosureFor("maker-b", "salt-a"));
    const offer = engine.createOffer({ ...physical(HOUSEHOLD, [{ product: "salt-a" }]), config_version: "cfg-b" });
    await expect(engine.present(offer.id)).rejects.toMatchObject({ code: "disclosure_missing" });
    engine.putDisclosure(disclosureFor("maker-b"));
    const again = engine.createOffer({ ...physical(HOUSEHOLD, [{ product: "salt-a" }]), config_version: "cfg-b" });
    expect((await engine.present(again.id)).state).toBe("presented");
  });
});

describe("§16.5 and §11.2: the cooling window takes back what the person signed, and nothing else", () => {
  /**
   * The hole this closes was found by a refutation pass on 2026-09-12, hours
   * after §6.5 was written to close the same hole from the other side. A
   * physical offer reaches `decided` when the collection resolves its last
   * candidate, and `withdrawDecisions` reset **every** candidate to `offered`.
   * The household then signed `returned` over goods it had eaten, `settle`
   * found no `consumed` line, asked for no statement, and charged nothing. The
   * receipt said the goods came back unopened.
   */
  // §16, question 54. A mandate reaches only its own household's offers, so
  // the fixture names the household the test makes its offer for.
  const cooling = (seconds: number | null, household = HOUSEHOLD) => ({
    async get(_id?: string) {
      return {
        id: MANDATE,
        household,
        ceiling_out_of_network: 1_000_000,
        ceiling_daily: null,
        cooling_seconds: seconds,
        co_signers: [],
        lapses_at: Date.now() + 86_400_000,
        version: 1,
      } as never;
    },
    async dailyCeilingOf() {
      // Question 60. Read only for a gift's giver, which these stubs never are.
      return null;
    },
    async holdsAny(h: string) {
      // §16.2, question 56. A stub that answers with a mandate must also say
      // whose it is, or an offer of that household naming another label is
      // refused before the stub is read.
      const m = (await this.get("")) as { household?: string } | undefined;
      return m?.household === h;
    },
  });

  test("a box the collection resolved cannot be taken back at all", async () => {
    // **This test used to assert that the withdrawal happened and left the
    // collection's verdicts alone**, which was the fix of 2026-09-12 for a
    // household signing `returned` over goods it had eaten. Question 43,
    // decided 2026-09-13, went further: **there is nothing here the household
    // signed, so there is no commitment to remove.** Allowing it returned the
    // box to `presented`, where it reached no section of the household's own
    // list, its signature over the statement was refused as out of state, and
    // §6.5's block lifted, so a presenter that withdrew the box left the
    // consumed goods charged to nobody.
    const made = makeEngine();
    const { engine } = made;
    engine.readMandatesFrom(cooling(3600));
    const offer = await collected(made);
    const [coffee, tea, nori] = offer.candidates;
    await expect(engine.withdrawDecisions(offer.id)).rejects.toMatchObject({ code: "not_withdrawable" });
    // The box is as it was, so the household can still sign its statement.
    const after = engine.mustGet(offer.id);
    expect(after.state).toBe("decided");
    expect(after.candidates.find((c) => c.id === coffee!.id)!.valence).toBe("consumed");
    expect(after.candidates.find((c) => c.id === tea!.id)!.valence).toBe("consumed");
    expect(after.candidates.find((c) => c.id === nori!.id)!.valence).toBe("returned");
    // And it cannot be signed over: §11.2 forbids the household naming the
    // verdict, whether or not a withdrawal was attempted first.
    await expect(
      decideSigned(engine, offer.id, [{ candidate: coffee!.id, valence: "returned" }])
    ).rejects.toMatchObject({ status: 409 });
  });

  test("what the household signed is still taken back", async () => {
    const { engine } = makeEngine();
    engine.readMandatesFrom(cooling(3600, HOUSEHOLD));
    const offer = engine.createOffer(physical(HOUSEHOLD, [{ product: "coffee-a" }, { product: "tea-b" }, { product: "miso-a" }]));
    await engine.present(offer.id);
    await decideSigned(engine, offer.id, offer.candidates.map((c) => ({ candidate: c.id, valence: "kept" as const, kept_as: "self" as const })));
    const taken = await engine.withdrawDecisions(offer.id);
    for (const c of taken.candidates) expect(c.valence).toBe("offered");
  });

  test("a collection cannot be taken back once recorded (question 46)", async () => {
    // NOTE (mutation check, 2026-09-14): withdraw_after_collection_allowed
    // drops the guard, and this rejection assertion fails. A refutation pass
    // measured the hole: the household kept a line, waited for the collection,
    // withdrew, and re-decided the kept item `returned`, keeping the goods for
    // nothing while the collection was past and could not contradict it. A
    // collection fixes what is in the home; the household's recourse is the
    // statement, not withdrawal.
    const made = makeEngine();
    const { engine, deliveries } = made;
    engine.readMandatesFrom(cooling(3600, HOUSEHOLD));
    const offer = engine.createOffer(physical(HOUSEHOLD, [{ product: "coffee-a" }, { product: "tea-b" }, { product: "miso-a" }]));
    await engine.present(offer.id);
    deliveries.record({ offer: offer.id, carriage: 550, code: `dc-${offer.id.slice(0, 8)}`, status: "delivered" });
    const [used, returned, kept] = offer.candidates;
    await decideSigned(engine, offer.id, [{ candidate: kept!.id, valence: "kept", kept_as: "self" }]);
    engine.collect({ offer: offer.id, consumed: [used!.id], returned: [returned!.id], at: Date.now() });
    await expect(engine.withdrawDecisions(offer.id)).rejects.toMatchObject({ code: "not_withdrawable" });
    // The box stays decided and settleable, so the consumed line is charged.
    expect(engine.mustGet(offer.id).state).toBe("decided");
    const settlement = await settleSigned(engine, offer.id);
    expect(settlement.consumed_amount).toBe(engine.mustGet(offer.id).candidates.find((c) => c.id === used!.id)!.unit_price);
  });

  test("a used box still settles only on the signature after the window", async () => {
    const made = makeEngine();
    const { engine } = made;
    engine.readMandatesFrom(cooling(null));
    const offer = await collected(made);
    await expect(engine.settle(offer.id)).rejects.toMatchObject({ code: "statement_unsigned" });
  });
});

describe("§6.5: the block is a pressure the household can lift, and nobody else can make permanent", () => {
  test("a collected box the household can settle is the only thing the block counts (question 46)", async () => {
    // After question 46 an unsettleable-yet-counted box cannot arise: a partial
    // collection is refused, a collected box cannot be withdrawn, and a
    // collection is refused on a withdrawn box. So the block only ever counts a
    // box the household can settle now, and signing lifts it.
    const made = makeEngine();
    const { engine } = made;
    const first = await collected(made, HOUSEHOLD);
    // The presenter cannot withdraw a decided box, so it cannot strand it.
    await expect(engine.withdraw(first.id)).rejects.toMatchObject({ status: 409 });
    // The next box is held until the household signs the first.
    const second = engine.createOffer(physical(HOUSEHOLD, [{ product: "nori-a" }, { product: "coffee-a" }]));
    await expect(engine.present(second.id)).rejects.toMatchObject({ code: "statement_unsigned" });
    await settleSigned(engine, first.id);
    expect((await engine.present(second.id)).state).toBe("presented");
  });

  test("the refusal names no offer at all", async () => {
    const made = makeEngine();
    const { engine } = made;
    const first = await collected(made, HOUSEHOLD);
    const second = engine.createOffer(physical(HOUSEHOLD, [{ product: "nori-a" }, { product: "coffee-a" }]));
    await expect(engine.present(second.id)).rejects.toMatchObject({ code: "statement_unsigned" });
    try {
      await engine.present(second.id);
    } catch (err) {
      expect((err as Error).message).not.toContain(first.id);
    }
  });

  test("another presenter's box is not blocked (clause 8)", async () => {
    // The block is the presenter's own view of its own offers, which is what
    // clause 8 gives a merchant. A block across presenters is an engine
    // computing the union clause 8 gives the person alone, and answering a
    // merchant out of it; §16.3 records the same objection against an engine
    // computing a household's daily total. Narrowed on the founder's decision
    // of 2026-09-12.
    const made = makeEngine();
    const { engine } = made;
    await collected(made, HOUSEHOLD);
    // A second presenter, with its own key and its own catalogue.
    const other = generateKeyPairSync("ed25519");
    engine.registerIdentity(
      "merchant-2",
      other.publicKey.export({ type: "spki", format: "pem" }).toString(),
      true
    );
    const config = {
      version: "cfg-second-presenter",
      presenter: "merchant-2",
      products: {
        "salt-a": { merchant: "maker-b", maker: "made-by-salt", ships: "carrier-b", price: 500, physical: PHYSICAL },
        "salt-b": { merchant: "maker-b", maker: "made-by-salt", ships: "carrier-b", price: 600, physical: PHYSICAL },
      },
    };
    engine.registerConfig(config, sign(null, canonicalConfig(config as never), other.privateKey).toString("base64"));
    engine.registerIdentity("maker-b", MERCHANT_PAIR.publicKey.export({ type: "spki", format: "pem" }).toString());
    engine.putDisclosure(disclosureFor("maker-b"));
    const theirs = engine.createOffer({
      ...physical(HOUSEHOLD, [{ product: "salt-a" }, { product: "salt-b" }]),
      config_version: "cfg-second-presenter",
    });
    expect((await engine.present(theirs.id)).state).toBe("presented");
  });
});

describe("§6.5: the statement's bytes are its own", () => {
  test("a decided set's signature does not verify as a statement", async () => {
    // Measured 2026-09-13: the domain-only statement_domain_dropped mutation
    // fails the prefix assertion below. Carriage remains in the bytes, so
    // this catch does not demonstrate a collision with a decided set.
    const made = makeEngine();
    const { engine } = made;
    const offer = await collected(made, HOUSEHOLD);
    const lines = statementLines(engine.mustGet(offer.id), []);
    const asDecisions = canonicalDecisions(
      offer.id,
      lines.map((l) => ({ candidate: l.candidate, valence: l.valence as never }))
    );
    expect(canonicalStatement(offer.id, 550, lines).equals(asDecisions)).toBe(false);
    expect(canonicalStatement(offer.id, 550, lines).toString("utf8").startsWith("valence.statement.1\n")).toBe(true);
  });
});

describe("§6, §16.3: nothing is written on refusal, at the ledger as well", () => {
  /**
   * The commit used to run before the daily ceiling was asked. On a refusal
   * the settlement was never written and the offer stayed `decided`, but the
   * reservation was already committed, and `commit` is idempotent, so a
   * second attempt returned the committed row and could not undo it. On an
   * adapter that moves money the household had been charged for a settlement
   * that does not exist. Found by a refutation pass on 2026-09-12.
   */
  const withCeiling = (daily: number) => ({
    async get(_id?: string) {
      return {
        id: MANDATE,
        household: HOUSEHOLD,
        ceiling_out_of_network: 1_000_000,
        ceiling_daily: daily,
        cooling_seconds: null,
        co_signers: [],
        lapses_at: Date.now() + 86_400_000,
        version: 1,
      } as never;
    },
    async dailyCeilingOf() {
      // Question 60. Read only for a gift's giver, which these stubs never are.
      return null;
    },
    async holdsAny(h: string) {
      // §16.2, question 56. A stub that answers with a mandate must also say
      // whose it is, or an offer of that household naming another label is
      // refused before the stub is read.
      const m = (await this.get("")) as { household?: string } | undefined;
      return m?.household === h;
    },
  });

  test("a settlement above the daily ceiling leaves the ledger holding, not committed", async () => {
    const { engine, ledger } = makeEngine();
    engine.readMandatesFrom(withCeiling(100));
    const offer = engine.createOffer({
      ...physical(HOUSEHOLD, [{ product: "coffee-a" }, { product: "tea-b" }]),
      binding: "digital" as const,
    });
    await engine.present(offer.id);
    await decideSigned(
      engine,
      offer.id,
      offer.candidates.map((c) => ({ candidate: c.id, valence: "kept" as const, kept_as: "self" as const }))
    );
    await expect(engine.settle(offer.id)).rejects.toMatchObject({ code: "mandate_ceiling_daily" });
    // The refusal is the whole of what happened: no settlement, and the hold
    // is still a hold.
    expect(engine.settlement(offer.id)).toBeUndefined();
    const row = ledger.get(offer.id)!;
    expect(row.status).toBe("held");
    expect(row.committed).toBeNull();
  });

  test("under the ceiling it commits exactly what the settlement records", async () => {
    const { engine, ledger } = makeEngine();
    engine.readMandatesFrom(withCeiling(1_000_000));
    const offer = engine.createOffer({
      ...physical(HOUSEHOLD, [{ product: "coffee-a" }, { product: "tea-b" }]),
      binding: "digital" as const,
    });
    await engine.present(offer.id);
    await decideSigned(
      engine,
      offer.id,
      offer.candidates.map((c) => ({ candidate: c.id, valence: "kept" as const, kept_as: "self" as const }))
    );
    const settlement = await engine.settle(offer.id);
    const row = ledger.get(offer.id)!;
    expect(row.status).toBe("committed");
    expect(row.committed).toBe(settlement.charged);
  });
});

describe("§6.5, §14.2: a move carries what the route found", () => {
  /**
   * A refutation pass on 2026-09-12 asked what a host move does to §6.5's
   * block, and the answer was that it lifted. The offers moved with their
   * `consumed` valences; the rows saying a collection had happened did not,
   * because the node export's `recoveries` is clause 53's account-recovery
   * log and not this. The receiving host presented the next box freely while
   * the sending host held a block over a household that had left. The
   * merchant's export carried the rows all along, so the shop kept what the
   * person lost.
   */
  test("a box whose statement is still owed stays at its host, and the block is per host", async () => {
    // §14.2 and §6.4, question 57, decided 2026-09-18 and rebuilt 2026-09-19.
    // This test used to carry the block across a move, because a refutation
    // pass on 2026-09-12 found the move lifted it. A third pass on question 57
    // then measured the other half: the box moved, the household's statement
    // was refused `no_reservation` at the new host, and **that presenter's next
    // box was refused there for good**, because the one act that lifts the
    // block could not succeed where there was no reserve. So what still has
    // money to move stays where its reserve is, and the block with it.
    const madeFirst = makeEngine();
    const first = madeFirst.engine;
    const offer = await collected(madeFirst, HOUSEHOLD);
    const next = first.createOffer(physical(HOUSEHOLD, [{ product: "nori-a" }, { product: "coffee-a" }]));
    await expect(first.present(next.id)).rejects.toMatchObject({ code: "statement_unsigned" });

    // The box does not move: its statement is owed and its reserve is here.
    const { engine: second } = makeEngine();
    expect(() => second.importOffer(first.mustGet(offer.id), HOUSEHOLD))
      .toThrow(expect.objectContaining({ code: "bad_state" }));

    // **The cost, stated**: the block is per host, so the new host presents the
    // next box while the old host still waits for the statement.
    const atSecond = second.createOffer(physical(HOUSEHOLD, [{ product: "nori-a" }, { product: "coffee-a" }]));
    expect((await second.present(atSecond.id)).state).toBe("presented");
  });

  test("an import never replaces a row this host already holds", async () => {
    // §14.2's rule for offers, for the same reason: a receiving host that
    // overwrote its own record of a collection would let whoever composed the
    // export decide what a box came back with.
    const made = makeEngine();
    const { engine } = made;
    const offer = await collected(made, HOUSEHOLD);
    const mine = engine.recoveries.for(offer.id)!;
    engine.recoveries.importRows([{ ...mine, consumed: [], returned: offer.candidates.map((c) => c.id) }]);
    expect(engine.recoveries.for(offer.id)!.consumed).toEqual(mine.consumed);
  });
});

describe("§6.2, clause 10: a gift is never billed, whatever became of it", () => {
  /**
   * **Measured on 2026-09-12 by a refutation pass over the hub, and it is the
   * worst thing this corpus has found.** `settle`'s `kept` branch added
   * `unit_price * quantity` for every line without asking whether it was
   * given, while the `consumed` branch had asked since 2026-09-09. So a gift
   * a household **kept** was charged at its price and a gift it **used** was
   * free, which is the rule exactly backwards.
   *
   * The statement written the same evening made the two disagree in the open:
   * `statementLines` puts 0 on a gift whatever its valence, so a household
   * signed a document reading 0 and the ledger committed the price. §6.5
   * exists so that what is signed is what is charged, and its first night
   * shipped the opposite.
   *
   * **Every earlier test consumed the gift and none kept one**, which is why
   * a rule with a probe, a mutation and three years of prose went untested on
   * the branch that mattered.
   */
  test("a kept gift settles at nothing, and the statement agrees with the receipt", async () => {
    const { engine, deliveries } = makeEngine();
    const offer = engine.createOffer(
      physical(HOUSEHOLD, [
        { product: "coffee-a" },
        { product: "tea-b", given_by: "maker-a" },
      ])
    );
    await engine.present(offer.id);
    deliveries.record({ offer: offer.id, carriage: 0, code: "dc-kept-gift", status: "delivered" });
    await decideSigned(engine, offer.id, [
      { candidate: offer.candidates[0]!.id, valence: "kept", kept_as: "self" },
      { candidate: offer.candidates[1]!.id, valence: "kept", kept_as: "self" },
    ]);
    const settlement = await engine.settle(offer.id);
    // coffee-a at 1500; the gift at nothing, because it was given.
    expect(settlement.kept_amount).toBe(1500);
    expect(settlement.charged).toBe(1500);
    expect(settlement.lines.find((l) => l.product === "tea-b")!.amount).toBe(0);
    // And the document a household would have signed says the same number.
    const proposed = statementLines(engine.mustGet(offer.id), []);
    expect(proposed.reduce((sum, l) => sum + l.amount, 0)).toBe(settlement.charged);
  });

  test("a defaulted gift settles at nothing too", async () => {
    // Clause 25's default ships when nothing was chosen, and a gift that
    // ships that way is still a gift; `defaulted` shares the line that billed
    // a kept one. **A ceremonial offer is the only way to reach that valence**
    // (§2.2), and the first version of this test used a `replenish` offer,
    // whose undecided candidates become `returned`: it passed at zero without
    // ever touching the branch it was written for, which is the shape this
    // file keeps finding.
    const { engine } = makeEngine();
    const offer = engine.createOffer({
      ...physical(HOUSEHOLD, [{ product: "coffee-a", given_by: "maker-a" }]),
      binding: "digital" as const,
      purpose: "ceremonial" as const,
      giver: GIFT_GIVER.household,
      price_band: { min: 1, max: 100_000 },
      expires_at: Date.now() + 700,
    });
    await presentGift(engine, offer.id);
    await new Promise((r) => setTimeout(r, 900));
    const settled = engine.mustGet(offer.id, Date.now());
    expect(settled.candidates[0]!.valence).toBe("defaulted");
    const settlement = await engine.settle(offer.id, Date.now());
    expect(settlement.charged).toBe(0);
  });

  /**
   * §6.5. Two tabs of the same statement. The first confirms everything, the
   * second disputes a line and signs after it. Settling is idempotent for a
   * presenter asking for the settlement that stands, and the second tab was
   * handed that settlement with a 200: the screen read "Signed" and named a
   * charge that included the line the household had just disputed, while the
   * dispute was never recorded anywhere. **A household signing is applying,
   * not asking.** Found by a refutation pass over the reference hub.
   */
  test("a signature over a box that already settled is refused rather than answered with the first settlement", async () => {
    const made = makeEngine();
    const offer = await collected(made, HOUSEHOLD);
    const first = await settleSigned(made.engine, offer.id);
    expect(first.charged).toBeGreaterThan(0);
    expect(first.disputed_amount).toBe(0);
    // The second tab disputes a consumed line and signs.
    const consumed = offer.candidates[0]!.id;
    await expect(settleSigned(made.engine, offer.id, [consumed])).rejects.toMatchObject({
      code: "already_settled",
    });
    // And the settlement that stands is untouched: nothing was recorded as
    // disputed by a signature the engine refused.
    expect(made.engine.settlement(offer.id)!.disputed_amount).toBe(0);
    // A presenter asking again, with no signature, still gets what stands.
    const again = await made.engine.settle(offer.id);
    expect(again.receipt).toBe(first.receipt);
  });

  /**
   * §7.5b, 法11条1号. The carriage is a figure the household read before it
   * signed. The register took a plain overwrite, so a despatch update after
   * the signature could carry a different one and the household had no record
   * of what it had been shown.
   */
  test("the same signature, sent twice, is the household's own application arriving twice", async () => {
    // §6.5. A household signs, the engine settles, the answer is lost. The
    // bytes it re-sends are the bytes that settled the box, and the engine
    // holds them: refusing tells the member its signature "was not what
    // settled it" while it is charged, and the hub has no settlement read
    // that could correct the impression. A **different** signature over a
    // different set is still refused, which is the two-tabs case.
    const made = makeEngine();
    const offer = await collected(made, HOUSEHOLD);
    const first = await settleSigned(made.engine, offer.id);
    const again = await settleSigned(made.engine, offer.id);
    expect(again.receipt).toBe(first.receipt);
    expect(again.charged).toBe(first.charged);
    // A signature over a set that disputes a line is not that signature.
    await expect(
      settleSigned(made.engine, offer.id, [offer.candidates[0]!.id])
    ).rejects.toMatchObject({ code: "already_settled" });
  });

  test("the reserve taken at presentation does not hold a gift's price", async () => {
    // §6.2, clause 10. A gift is never billed, so it is not part of what the
    // offer can come to. Nothing was ever charged by the reserve, which is
    // why it outlived by three days the settlement rule it contradicts.
    const { engine, ledger } = makeEngine();
    const offer = engine.createOffer(
      physical(HOUSEHOLD, [{ product: "coffee-a" }, { product: "tea-b", given_by: "maker-a" }])
    );
    await engine.present(offer.id);
    // coffee-a at 1500, and the gift at nothing.
    expect(ledger.get(offer.id)!.reserved).toBe(1500);
  });

  test("a signature against one carriage does not settle a box recorded at another", async () => {
    // §6.5, question 40, decided 2026-09-13. The carriage is the one item
    // 法11条1号 puts on this screen beside the price, and the signature covered
    // the lines and not it: a household read a figure, signed, and had no
    // record anywhere that it had.
    const made = makeEngine();
    const offer = await collected(made, HOUSEHOLD);
    const lines = statementLines(made.engine.mustGet(offer.id), []);
    // The box was delivered at 550. A signature over 0 is a signature over a
    // screen nobody was shown.
    const wrong = sign(null, canonicalStatement(offer.id, 0, lines), MANDATE_PAIR.privateKey).toString("base64");
    await expect(
      made.engine.settle(offer.id, Date.now(), { signed: { signature: wrong } })
    ).rejects.toMatchObject({ code: "bad_signature" });
    // And the figure that was recorded settles it.
    const right = sign(null, canonicalStatement(offer.id, 550, lines), MANDATE_PAIR.privateKey).toString("base64");
    const settlement = await made.engine.settle(offer.id, Date.now(), { signed: { signature: right } });
    expect(settlement.charged).toBe(1500 + 900);
  });

  test("a delivery update may move the status and may not move the carriage", async () => {
    const { deliveries } = makeEngine();
    deliveries.record({ offer: "o-carriage", carriage: 500, code: "dc-1", status: "placed" });
    const moved = deliveries.record({ offer: "o-carriage", carriage: 500, code: "dc-1", status: "delivered" });
    expect(moved.status).toBe("delivered");
    expect(() =>
      deliveries.record({ offer: "o-carriage", carriage: 800, code: "dc-1", status: "delivered" })
    ).toThrow(/carriage/);
    expect(deliveries.mustGet("o-carriage").carriage).toBe(500);
  });
});

describe("§12, §16.3, question 60: a gift is held to the daily ceiling of whoever pays", () => {
  /**
   * A ceremonial offer names the recipient's mandate and charges the giver.
   * Measured on 2026-09-19 by the fifth refutation pass over question 57: the
   * recipient's ceiling was read and the recipient's day was counted, so a
   * giver with a ceiling of 500 was charged 1200, and a recipient with a
   * ceiling of 500 had a gift refused that it pays nothing for.
   */
  const GIVER = GIFT_GIVER.household;
  const ceilings = (recipient: number | null, giver: number | null) => ({
    async get(_id?: string) {
      return {
        id: MANDATE, household: HOUSEHOLD, ceiling_out_of_network: 1_000_000, ceiling_daily: recipient,
        cooling_seconds: null, co_signers: [], lapses_at: Date.now() + 86_400_000, version: 1,
      } as never;
    },
    async dailyCeilingOf(h: string) {
      return h === GIVER ? giver : null;
    },
    async holdsAny(h: string) {
      return h === HOUSEHOLD;
    },
  });
  const gift = async (engine: ReturnType<typeof makeEngine>["engine"]) => {
    const offer = engine.createOffer({
      ...physical(HOUSEHOLD, [{ product: "coffee-a" }, { product: "tea-b" }]),
      binding: "digital" as const,
      purpose: "ceremonial" as const,
      price_band: { min: 0, max: 1_000_000 },
      giver: GIVER,
    });
    await presentGift(engine, offer.id);
    await decideSigned(engine, offer.id, [
      { candidate: offer.candidates[0]!.id, valence: "kept" as const, kept_as: "self" as const },
      { candidate: offer.candidates[1]!.id, valence: "returned" as const },
    ]);
    return offer;
  };

  test("the giver's ceiling refuses the gift, and nothing is committed", async () => {
    const { engine, ledger } = makeEngine();
    engine.readMandatesFrom(ceilings(null, 1));
    const offer = await gift(engine);
    await expect(engine.settle(offer.id)).rejects.toMatchObject({ code: "mandate_ceiling_daily" });
    expect(ledger.get(offer.id)!.status).toBe("held");
  });

  test("the recipient's ceiling does not refuse a gift the recipient does not pay for, and the day counted is the giver's", async () => {
    const { engine } = makeEngine();
    engine.readMandatesFrom(ceilings(1, null));
    const reported: { household: string; amount: number }[] = [];
    engine.readTheDayFrom({
      async totalSince() { return 0; },
      async report(r: { household: string; amount: number }) { reported.push(r); },
      async reportOffer() {},
    } as never);
    const offer = await gift(engine);
    const settlement = await engine.settle(offer.id);
    expect(settlement.payer).toBe(GIVER);
    expect(settlement.charged).toBeGreaterThan(1);
    expect(reported.map((r) => r.household)).toEqual([GIVER]);
  });
});

describe("§6.4, question 62: a set that owes nothing settles at nothing, at once", () => {
  /**
   * A set with every line returned held its reserve until the presenter
   * settled it at 0, which nothing obliged it to do. Measured by the fifth
   * refutation pass over question 57: such a set could not move, so the
   * household's record of what it refused stayed behind.
   */
  const cooling = (seconds: number | null) => ({
    async get(_id?: string) {
      return {
        id: MANDATE, household: HOUSEHOLD, ceiling_out_of_network: 1_000_000, ceiling_daily: null,
        cooling_seconds: seconds, co_signers: [], lapses_at: Date.now() + 86_400_000, version: 1,
      } as never;
    },
    async dailyCeilingOf() { return null; },
    async holdsAny(h: string) { return h === HOUSEHOLD; },
  });
  const returnedSet = async (engine: ReturnType<typeof makeEngine>["engine"], valence: "returned" | "kept" = "returned") => {
    const offer = engine.createOffer({
      ...physical(HOUSEHOLD, [{ product: "coffee-a" }, { product: "tea-b" }]),
      binding: "digital" as const,
    });
    await engine.present(offer.id);
    await decideSigned(engine, offer.id, offer.candidates.map((c) => (valence === "kept"
      ? { candidate: c.id, valence: "kept" as const, kept_as: "self" as const }
      : { candidate: c.id, valence: "returned" as const })));
    return offer;
  };

  test("with no cooling window it settles at the decision and releases the reserve", async () => {
    // NOTE (mutation check, 2026-09-19): decide_leaves_what_owes_nothing.
    const { engine, ledger } = makeEngine();
    engine.readMandatesFrom(cooling(null));
    const offer = await returnedSet(engine);
    expect(engine.mustGet(offer.id).state).toBe("settled");
    expect(engine.settlement(offer.id)!.charged).toBe(0);
    expect(ledger.get(offer.id)!.status).toBe("released");
  });

  test("inside a cooling window it waits, and the export's pass settles it once the window has closed", async () => {
    const { engine, ledger } = makeEngine();
    engine.readMandatesFrom(cooling(60));
    const offer = await returnedSet(engine);
    expect(engine.mustGet(offer.id).state).toBe("decided");
    expect(await engine.settleWhatOwesNothing(HOUSEHOLD)).toBe(0);
    expect(engine.mustGet(offer.id).state).toBe("decided");
    expect(await engine.settleWhatOwesNothing(HOUSEHOLD, Date.now() + 61_000)).toBe(1);
    expect(engine.mustGet(offer.id).state).toBe("settled");
    expect(ledger.get(offer.id)!.status).toBe("released");
  });

  test("a set that owes something is left for the presenter to settle", async () => {
    const { engine, ledger } = makeEngine();
    engine.readMandatesFrom(cooling(null));
    const offer = await returnedSet(engine, "kept");
    expect(await engine.settleWhatOwesNothing(HOUSEHOLD)).toBe(0);
    expect(engine.mustGet(offer.id).state).toBe("decided");
    expect(ledger.get(offer.id)!.status).toBe("held");
  });
});

describe("§6.4, §11.2, question 62: a box is not finished until it is collected", () => {
  /**
   * A first refutation pass over question 62 measured the household deciding
   * every line of a physical box `returned`, the box settling at 0 on that
   * word alone, and the collection then refused on a settled offer: the
   * household ate the box for free.
   */
  const noWindow = {
    async get(_id?: string) {
      return {
        id: MANDATE, household: HOUSEHOLD, ceiling_out_of_network: 1_000_000, ceiling_daily: 0,
        cooling_seconds: null, co_signers: [], lapses_at: Date.now() + 86_400_000, version: 1,
      } as never;
    },
    async dailyCeilingOf() { return null; },
    async holdsAny(h: string) { return h === HOUSEHOLD; },
  };

  test("a box the household called returned waits for its collection, which can still find a line used", async () => {
    // NOTE (mutation check, 2026-09-19): nothing_owed_before_collection.
    const made = makeEngine();
    const { engine, ledger, deliveries } = made;
    engine.readMandatesFrom(noWindow);
    const offer = engine.createOffer(physical(HOUSEHOLD, [{ product: "coffee-a" }, { product: "tea-b" }]));
    await engine.present(offer.id);
    await decideSigned(engine, offer.id, offer.candidates.map((c) => ({ candidate: c.id, valence: "returned" as const })));
    expect(engine.mustGet(offer.id).state).toBe("decided");
    expect(ledger.get(offer.id)!.status).toBe("held");
    expect(await engine.settleWhatOwesNothing(HOUSEHOLD)).toBe(0);
    deliveries.record({ offer: offer.id, carriage: 550, code: `dc-${offer.id.slice(0, 8)}`, status: "delivered" });
    engine.collect({ offer: offer.id, returned: [offer.candidates[1]!.id], consumed: [offer.candidates[0]!.id], at: Date.now() });
    expect(engine.mustGet(offer.id).candidates[0]!.valence).toBe("consumed");
  });

  test("a box collected with nothing used settles at nothing at the export, on a day already past the ceiling", async () => {
    // NOTE (mutation check, 2026-09-19): zero_settle_meets_the_ceiling. The
    // ceiling here is 0 and the day already holds 1, so the zero settlement
    // was refused `mandate_ceiling_daily` and the box stayed behind its
    // reserve, which is the case question 62 was opened for.
    const made = makeEngine();
    const { engine, ledger } = made;
    engine.readMandatesFrom(noWindow);
    engine.readTheDayFrom({ async totalSince() { return 1; }, async report() {}, async reportOffer() {} } as never);
    const offer = engine.createOffer(physical(HOUSEHOLD, [{ product: "coffee-a" }, { product: "tea-b" }]));
    await engine.present(offer.id);
    engine.collect({ offer: offer.id, returned: offer.candidates.map((c) => c.id), consumed: [], at: Date.now() });
    engine.applyRecoveryTo(offer.id);
    expect(engine.mustGet(offer.id).state).toBe("decided");
    expect(await engine.settleWhatOwesNothing(HOUSEHOLD)).toBe(1);
    expect(engine.settlement(offer.id)!.charged).toBe(0);
    expect(ledger.get(offer.id)!.status).toBe("released");
  });
});
