import { describe, expect, test } from "bun:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { CONFIG_VERSION, HOUR, MANDATE_PAIR, MERCHANT_PAIR, PHYSICAL, makeEngine, settleSigned, decideSigned, disclosureFor, signConfig } from "./helpers.js";
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
  mandate: "mandate-1",
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

async function collected(
  made: ReturnType<typeof makeEngine>,
  household = "house-s"
) {
  const { engine, deliveries } = made;
  const offer = engine.createOffer(physical(household, [{ product: "coffee-a" }, { product: "tea-b" }, { product: "miso-a" }]));
  await engine.present(offer.id);
  // §6.5, 法11条1号. A box that was delivered and collected has a delivery
  // record, and the statement renders the carriage from it. A merchant whose
  // price includes carriage records 0; `null` is an implementation that never
  // recorded what it did, and `settle` refuses it.
  deliveries.record({ offer: offer.id, carriage: 550, code: `dc-${offer.id.slice(0, 8)}`, status: "delivered" });
  engine.recoveries.collect({
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
    const forged = sign(null, canonicalStatement(offer.id, lines), stranger.privateKey).toString("base64");
    await expect(engine.settle(offer.id, Date.now(), { signed: { signature: forged } })).rejects.toMatchObject({ code: "bad_signature" });
    // The right key over a statement that disputes a line, sent without the
    // dispute: the bytes differ and the signature does not cover what is sent.
    const other = sign(null, canonicalStatement(offer.id, statementLines(offer, [offer.candidates[0]!.id])), MANDATE_PAIR.privateKey).toString("base64");
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
    const offer = engine.createOffer(physical("house-clean", [{ product: "coffee-a" }, { product: "tea-b" }]));
    await engine.present(offer.id);
    engine.recoveries.collect({ offer: offer.id, returned: offer.candidates.map((c) => c.id), consumed: [], at: Date.now() });
    engine.applyRecoveryTo(offer.id);
    const settlement = await engine.settle(offer.id);
    expect(settlement.charged).toBe(0);
    expect(settlement.confirmation).toBeNull();
  });

  test("the next box does not come while a statement stands unsigned", async () => {
    const made = makeEngine();
    const { engine } = made;
    const first = await collected(made, "house-next");
    const second = engine.createOffer(physical("house-next", [{ product: "nori-a" }, { product: "coffee-a" }]));
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
    const withTea = engine.createOffer(physical("house-p", [{ product: "tea-a" }, { product: "tea-b" }]));
    expect(withTea.disclosures.map((d) => d.product).sort()).toEqual([null, "tea-a"].sort());
    const without = engine.createOffer(physical("house-q", [{ product: "coffee-a" }, { product: "tea-b" }]));
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
    const offer = engine.createOffer({ ...physical("house-b", [{ product: "salt-a" }]), config_version: "cfg-b" });
    await expect(engine.present(offer.id)).rejects.toMatchObject({ code: "disclosure_missing" });
    engine.putDisclosure(disclosureFor("maker-b"));
    const again = engine.createOffer({ ...physical("house-b2", [{ product: "salt-a" }]), config_version: "cfg-b" });
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
  const cooling = (seconds: number | null) => ({
    async get() {
      return {
        id: "mandate-1",
        household: "house-s",
        ceiling_out_of_network: 1_000_000,
        ceiling_daily: null,
        cooling_seconds: seconds,
        co_signers: [],
        lapses_at: Date.now() + 86_400_000,
        version: 1,
      } as never;
    },
  });

  test("a candidate the collection resolved is not reset, and cannot be re-signed", async () => {
    const made = makeEngine();
    const { engine } = made;
    engine.readMandatesFrom(cooling(3600));
    const offer = await collected(made);
    const [coffee, tea, nori] = offer.candidates;
    const taken = await engine.withdrawDecisions(offer.id);
    // The collection's two verdicts stand; the third, which the collection
    // returned, stands too. There is nothing here the household signed.
    expect(taken.candidates.find((c) => c.id === coffee!.id)!.valence).toBe("consumed");
    expect(taken.candidates.find((c) => c.id === tea!.id)!.valence).toBe("consumed");
    expect(taken.candidates.find((c) => c.id === nori!.id)!.valence).toBe("returned");
    // And the household cannot sign over them: `consumed` and `lost` are
    // refused as decisions, and `returned` over a consumed candidate would be
    // the household naming the verdict, which §11.2 forbids.
    await expect(
      decideSigned(engine, offer.id, [{ candidate: coffee!.id, valence: "returned" }])
    ).rejects.toMatchObject({ status: 409 });
  });

  test("what the household signed is still taken back", async () => {
    const { engine } = makeEngine();
    engine.readMandatesFrom(cooling(3600));
    const offer = engine.createOffer(physical("house-mix", [{ product: "coffee-a" }, { product: "tea-b" }, { product: "miso-a" }]));
    await engine.present(offer.id);
    await decideSigned(engine, offer.id, offer.candidates.map((c) => ({ candidate: c.id, valence: "kept" as const, kept_as: "self" as const })));
    const taken = await engine.withdrawDecisions(offer.id);
    for (const c of taken.candidates) expect(c.valence).toBe("offered");
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
  test("a withdrawn box does not block the next one", async () => {
    // A presenter that collects part of a box and then withdraws it leaves an
    // offer that can never be settled. Counting it blocked that household's
    // every future physical box, from every presenter, for good.
    const { engine } = makeEngine();
    const first = engine.createOffer(physical("house-w", [{ product: "coffee-a" }, { product: "tea-b" }, { product: "miso-a" }]));
    await engine.present(first.id);
    engine.recoveries.collect({ offer: first.id, returned: [], consumed: [first.candidates[0]!.id], at: Date.now() });
    engine.applyRecoveryTo(first.id);
    await engine.withdraw(first.id);
    const second = engine.createOffer(physical("house-w", [{ product: "nori-a" }, { product: "coffee-a" }]));
    expect((await engine.present(second.id)).state).toBe("presented");
  });

  test("a box the household cannot yet settle does not block the next one", async () => {
    // A partial collection leaves the offer `presented`, where `settle` is a
    // 409. A block counting it is one the household is forbidden to cure.
    const { engine } = makeEngine();
    const first = engine.createOffer(physical("house-p2", [{ product: "coffee-a" }, { product: "tea-b" }, { product: "miso-a" }]));
    await engine.present(first.id);
    engine.recoveries.collect({ offer: first.id, returned: [], consumed: [first.candidates[0]!.id], at: Date.now() });
    engine.applyRecoveryTo(first.id);
    expect(engine.mustGet(first.id).state).toBe("presented");
    await expect(engine.settle(first.id)).rejects.toMatchObject({ status: 409 });
    const second = engine.createOffer(physical("house-p2", [{ product: "nori-a" }, { product: "coffee-a" }]));
    expect((await engine.present(second.id)).state).toBe("presented");
  });

  test("the refusal names no offer at all", async () => {
    const made = makeEngine();
    const { engine } = made;
    const first = await collected(made, "house-quiet");
    const second = engine.createOffer(physical("house-quiet", [{ product: "nori-a" }, { product: "coffee-a" }]));
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
    await collected(made, "house-two-shops");
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
      ...physical("house-two-shops", [{ product: "salt-a" }, { product: "salt-b" }]),
      config_version: "cfg-second-presenter",
    });
    expect((await engine.present(theirs.id)).state).toBe("presented");
  });
});

describe("§6.5: the statement's bytes are its own", () => {
  test("a decided set's signature does not verify as a statement", async () => {
    const made = makeEngine();
    const { engine } = made;
    const offer = await collected(made, "house-tag");
    const lines = statementLines(engine.mustGet(offer.id), []);
    const asDecisions = canonicalDecisions(
      offer.id,
      lines.map((l) => ({ candidate: l.candidate, valence: l.valence as never }))
    );
    expect(canonicalStatement(offer.id, lines).equals(asDecisions)).toBe(false);
    expect(canonicalStatement(offer.id, lines).toString("utf8").startsWith("valence.statement.1\n")).toBe(true);
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
    async get() {
      return {
        id: "mandate-1",
        household: "house-ceiling",
        ceiling_out_of_network: 1_000_000,
        ceiling_daily: daily,
        cooling_seconds: null,
        co_signers: [],
        lapses_at: Date.now() + 86_400_000,
        version: 1,
      } as never;
    },
  });

  test("a settlement above the daily ceiling leaves the ledger holding, not committed", async () => {
    const { engine, ledger } = makeEngine();
    engine.readMandatesFrom(withCeiling(100));
    const offer = engine.createOffer({
      ...physical("house-ceiling", [{ product: "coffee-a" }, { product: "tea-b" }]),
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
      ...physical("house-ceiling", [{ product: "coffee-a" }, { product: "tea-b" }]),
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
  test("without the rows the block lifts, and with them it holds", async () => {
    const madeFirst = makeEngine();
    const first = madeFirst.engine;
    const offer = await collected(madeFirst, "house-moving");
    // The sending host blocks the next box.
    const next = first.createOffer(physical("house-moving", [{ product: "nori-a" }, { product: "coffee-a" }]));
    await expect(first.present(next.id)).rejects.toMatchObject({ code: "statement_unsigned" });

    // A move that carries the offers and not the collections: the receiving
    // host has the `consumed` valences and no record of a collection.
    const { engine: blind } = makeEngine();
    blind.importOffer(first.mustGet(offer.id), "house-moving");
    const atBlind = blind.createOffer(physical("house-moving", [{ product: "nori-a" }, { product: "coffee-a" }]));
    expect((await blind.present(atBlind.id)).state).toBe("presented");

    // The same move carrying them.
    const { engine: second } = makeEngine();
    second.importOffer(first.mustGet(offer.id), "house-moving");
    second.recoveries.importRows([first.recoveries.for(offer.id)!]);
    const atSecond = second.createOffer(physical("house-moving", [{ product: "nori-a" }, { product: "coffee-a" }]));
    await expect(second.present(atSecond.id)).rejects.toMatchObject({ code: "statement_unsigned" });
  });

  test("an import never replaces a row this host already holds", async () => {
    // §14.2's rule for offers, for the same reason: a receiving host that
    // overwrote its own record of a collection would let whoever composed the
    // export decide what a box came back with.
    const made = makeEngine();
    const { engine } = made;
    const offer = await collected(made, "house-own-row");
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
      physical("house-kept-gift", [
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
      ...physical("house-default-gift", [{ product: "coffee-a", given_by: "maker-a" }]),
      binding: "digital" as const,
      purpose: "ceremonial" as const,
      giver: "a-giver",
      price_band: { min: 1, max: 100_000 },
      expires_at: Date.now() + 700,
    });
    await engine.present(offer.id);
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
    const offer = await collected(made, "house-two-tabs");
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
