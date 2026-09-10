import { describe, expect, test } from "bun:test";
import { ValenceEngine, explorationFloor } from "../src/engine/offers.js";
import { InMemoryLedger } from "../src/engine/ledger.js";
import { ValenceError } from "../src/common/errors.js";
import { CONFIG_VERSION, HOUR, makeEngine, signer, decideSigned, signConfig } from "./helpers.js";

const baseOffer = (candidates: {
  product: string;
  quantity?: number;
  predicted_conversion?: number | null;
  is_exploration?: boolean;
  given_by?: string | null;
}[], overrides: Record<string, unknown> = {}) => ({
  binding: "digital" as const,
  household: "house-1",
  purpose: "replenish" as const,
  config_version: CONFIG_VERSION,
  expires_at: Date.now() + HOUR,
  mandate: "mandate-1",
  price_band: null,
  giver: null,
  candidates: candidates.map((c) => ({
    product: c.product,
    quantity: c.quantity ?? 1,
    predicted_conversion: c.predicted_conversion ?? 0.5,
    is_exploration: c.is_exploration ?? false,
    given_by: c.given_by ?? null,
  })),
  ...overrides,
});

describe("construction", () => {
  test("refuses an exploration rate of zero", () => {
    expect(
      () =>
        new ValenceEngine(new InMemoryLedger(), {
          explorationRate: 0,
          reminderLimit: 1,
          recoveryGraceDays: 3,
          relyingPartyId: "unit.example",
        })
    ).toThrow(/greater than zero/);
  });

  test("refuses a deployment that has not said what a device signs for", () => {
    // §14b. An engine that cannot tell whom an assertion was made for cannot
    // check one, and §10.5 requires every implementation to accept the
    // assertion shape, so there is no conforming deployment without a name.
    expect(
      () =>
        new ValenceEngine(new InMemoryLedger(), {
          explorationRate: 0.2,
          reminderLimit: 1,
          recoveryGraceDays: 3,
          relyingPartyId: "  ",
        })
    ).toThrow(/relyingPartyId/);
  });

  test("the config is frozen, so nothing at runtime reaches zero", () => {
    const { engine } = makeEngine();
    expect(() => {
      (engine.config as { explorationRate: number }).explorationRate = 0;
    }).toThrow();
    expect(engine.config.explorationRate).toBe(0.2);
  });
});

describe("exploration floor", () => {
  test("floor is at least one however small the rate", () => {
    expect(explorationFloor(3, 0.01)).toBe(1);
    expect(explorationFloor(10, 0.2)).toBe(2);
    expect(explorationFloor(11, 0.2)).toBe(3);
  });

  test("an offer below the floor is refused with 422", () => {
    const { engine } = makeEngine();
    try {
      engine.createOffer(
        baseOffer([{ product: "tea-a" }, { product: "tea-b" }])
      );
      throw new Error("expected a refusal");
    } catch (err) {
      expect(err).toBeInstanceOf(ValenceError);
      expect((err as ValenceError).status).toBe(422);
      expect((err as ValenceError).code).toBe("exploration_floor");
    }
  });

  test("an offer at the floor is created", () => {
    const { engine } = makeEngine();
    const offer = engine.createOffer(
      baseOffer([
        { product: "tea-a" },
        { product: "tea-b", is_exploration: true, predicted_conversion: 0.05 },
      ])
    );
    expect(offer.exploration_floor_met).toBe(true);
    expect(offer.state).toBe("drafted");
  });

  test("a presenter with nothing new for this household makes it no offer", async () => {
    const { engine } = makeEngine();
    const all = ["tea-a", "tea-b", "coffee-a", "miso-a", "nori-a"];
    const first = engine.createOffer(
      baseOffer(all.map((product, i) => ({ product, is_exploration: i === 0, predicted_conversion: 0.5 })))
    );
    await engine.present(first.id);
    // Every product has now been offered, so nothing qualifies as
    // exploration. The floor does not fall to zero: the offer is refused
    // until the presenter's range grows (§5, clause 26). A cap that let the
    // floor fall was written and withdrawn on 2026-09-09, because it made
    // selling out reachable for any small catalogue.
    expect(() =>
      engine.createOffer(baseOffer(all.map((product) => ({ product, is_exploration: false, predicted_conversion: 0.5 }))))
    ).toThrow(/nothing_new|everything it has/);
  });

  test("a product already offered to the household cannot pad the floor", async () => {
    const { engine } = makeEngine();
    const first = engine.createOffer(
      baseOffer([
        { product: "tea-a" },
        { product: "tea-b", is_exploration: true, predicted_conversion: 0.9 },
      ])
    );
    // A high prediction on a never-offered product is exploration: the
    // household has not seen it, whatever the presenter expects.
    await engine.present(first.id);
    // Offered once, the same product is no longer exploration, whatever the
    // prediction says, and whatever the household decided.
    expect(() =>
      engine.createOffer(
        baseOffer([
          { product: "tea-a" },
          { product: "tea-b", is_exploration: true, predicted_conversion: 0.05 },
        ])
      )
    ).toThrow();
  });
});

describe("price", () => {
  test("unit_price comes from the frozen catalogue", () => {
    const { engine } = makeEngine();
    const offer = engine.createOffer(
      baseOffer([
        { product: "tea-a" },
        { product: "tea-b", is_exploration: true, predicted_conversion: 0.05 },
      ])
    );
    expect(offer.candidates[0]!.unit_price).toBe(1200);
  });

  test("a later catalogue does not change an outstanding offer", async () => {
    const { engine } = makeEngine();
    const offer = engine.createOffer(
      baseOffer([
        { product: "tea-a" },
        { product: "tea-b", is_exploration: true, predicted_conversion: 0.05 },
      ])
    );
    await engine.present(offer.id);
    const later = {
      version: "cfg-2",
      presenter: "merchant-1",
      products: { "tea-a": { merchant: "maker-a", ships: "carrier-a", price: 9900 }, "tea-b": { merchant: "maker-a", ships: "carrier-a", price: 900 } },
    };
    engine.registerConfig(later, signConfig(later));
    await decideSigned(engine, offer.id, [
      { candidate: offer.candidates[0]!.id, valence: "kept", kept_as: "self" },
      { candidate: offer.candidates[1]!.id, valence: "returned" },
    ]);
    const settlement = await engine.settle(offer.id);
    expect(settlement.kept_amount).toBe(1200);
  });
});

describe("silence", () => {
  test("an undecided digital offer creates no charge at expiry", async () => {
    const { engine, ledger } = makeEngine();
    const now = Date.now();
    const offer = engine.createOffer(
      baseOffer(
        [
          { product: "tea-a" },
          { product: "tea-b", is_exploration: true, predicted_conversion: 0.05 },
        ],
        { expires_at: now + 1000 }
      )
    );
    await engine.present(offer.id, now);
    const settlement = await engine.settle(offer.id, now + 2000);
    expect(settlement.kept_amount).toBe(0);
    expect(offer.candidates.every((c) => c.valence === "returned")).toBe(true);
    expect(ledger.get(offer.id)!.status).toBe("released");
  });

  test("a ceremonial offer ships exactly one default", async () => {
    const { engine } = makeEngine();
    const now = Date.now();
    const offer = engine.createOffer(
      baseOffer(
        [
          { product: "tea-a" },
          { product: "nori-a" },
          { product: "miso-a", is_exploration: true, predicted_conversion: 0.05 },
        ],
        { purpose: "ceremonial", expires_at: now + 1000, price_band: { min: 0, max: 100000 }, giver: "giver-1" }
      )
    );
    await engine.present(offer.id, now);
    const settlement = await engine.settle(offer.id, now + 2000);
    const defaulted = offer.candidates.filter((c) => c.valence === "defaulted");
    expect(defaulted.length).toBe(1);
    expect(settlement.kept_amount).toBe(defaulted[0]!.unit_price);
  });

  test("at most one reminder", async () => {
    const { engine } = makeEngine();
    const offer = engine.createOffer(
      baseOffer([
        { product: "tea-a" },
        { product: "tea-b", is_exploration: true, predicted_conversion: 0.05 },
      ])
    );
    await engine.present(offer.id);
    engine.remind(offer.id);
    expect(() => engine.remind(offer.id)).toThrow(/reminder/);
  });
});

describe("settlement", () => {
  test("the reserve is a ceiling", async () => {
    const { engine, ledger } = makeEngine();
    const offer = engine.createOffer(
      baseOffer([
        { product: "tea-a" },
        { product: "tea-b", is_exploration: true, predicted_conversion: 0.05 },
      ])
    );
    await engine.present(offer.id);
    const reserved = ledger.get(offer.id)!.reserved;
    expect(reserved).toBe(1200 + 900);
    await expect(
      ledger.commit({ requestId: offer.id, amount: reserved + 1 })
    ).rejects.toThrow(/exceeds the reserved/);
  });

  test("lost is reported and not charged", async () => {
    // §11. Lost is what the deadline decides about goods nobody collected;
    // no household or presenter declares it. The offer expires, the grace
    // period passes with no collection, and both candidates are lost.
    const { engine } = makeEngine();
    const expiresAt = Date.now() + 1000;
    const offer = engine.createOffer(
      baseOffer(
        [
          { product: "tea-a" },
          { product: "tea-b", is_exploration: true, predicted_conversion: 0.05 },
        ],
        { binding: "physical", expires_at: expiresAt }
      )
    );
    await engine.present(offer.id);
    const afterGrace = expiresAt + 4 * 86_400_000;
    const settlement = await engine.settle(offer.id, afterGrace);
    expect(settlement.lost_amount).toBe(1200 + 900);
    expect(settlement.kept_amount).toBe(0);
    expect(settlement.consumed_amount).toBe(0);
    expect(settlement.charged).toBe(0);
  });

  test("a gift is never billed to its recipient and anything else used is bought", async () => {
    // §6.2, clause 10. Two bases and no third: the cost of goods left the
    // model on 2026-09-09, when charging a household a cost basis was judged
    // to price the same goods two ways.
    const { engine } = makeEngine();
    const offer = engine.createOffer(
      baseOffer(
        [
          { product: "coffee-a" },
          { product: "miso-a", given_by: "maker-a" },
          { product: "tea-b", is_exploration: true, predicted_conversion: 0.05 },
        ],
        { binding: "physical" }
      )
    );
    await engine.present(offer.id);
    // §11. Consumed is what the collection found, not a verdict.
    engine.recoveries.collect({
      offer: offer.id,
      returned: [offer.candidates[2]!.id],
      consumed: [offer.candidates[0]!.id, offer.candidates[1]!.id],
      at: Date.now(),
    });
    engine.applyRecoveryTo(offer.id);
    const settlement = await engine.settle(offer.id);
    // coffee-a at its price, the gift at nothing.
    expect(settlement.consumed_amount).toBe(1500);
    expect(settlement.charged).toBe(1500);
    const giftLine = settlement.lines.find((l) => l.product === "miso-a")!;
    expect(giftLine.amount).toBe(0);
  });

  test("consumed and lost are never a household's decision", async () => {
    const { engine } = makeEngine();
    const offer = engine.createOffer(
      baseOffer([
        { product: "tea-a" },
        { product: "tea-b", is_exploration: true, predicted_conversion: 0.05 },
      ])
    );
    await engine.present(offer.id);
    // decide reads the mandate through §13.1's source, so it is async and the
    // refusal is a rejected promise rather than a thrown value.
    expect(
      decideSigned(engine, offer.id, [
        { candidate: offer.candidates[0]!.id, valence: "consumed" },
      ])
    ).rejects.toThrow(/collection/);
  });

  test("settled is terminal", async () => {
    const { engine } = makeEngine();
    const offer = engine.createOffer(
      baseOffer([
        { product: "tea-a" },
        { product: "tea-b", is_exploration: true, predicted_conversion: 0.05 },
      ])
    );
    await engine.present(offer.id);
    await decideSigned(engine, offer.id, [
      { candidate: offer.candidates[0]!.id, valence: "kept", kept_as: "self" },
      { candidate: offer.candidates[1]!.id, valence: "returned" },
    ]);
    await engine.settle(offer.id);
    await expect(engine.withdraw(offer.id)).rejects.toThrow(/settled/);
  });
});

describe("lineage", () => {
  test("an edge is accepted on its signature, not its client", () => {
    const { engine } = makeEngine();
    const giver = signer();
    engine.registerIdentity("key-giver", giver.pem);
    const input = {
      from: "key-giver",
      to: "key-recipient",
      product: "tea-a",
      merchant: "merchant-1",
      kind: "gift" as const,
      occasion: "birth",
      receipt: "receipt-1",
    };
    const edge = engine.acceptEdge({ ...input, signature: giver.sign(input) });
    expect(edge.from).toBe("key-giver");
    expect(engine.receiptsFor("key-recipient").length).toBe(1);
  });

  test("a bad signature is refused", () => {
    const { engine } = makeEngine();
    const giver = signer();
    const other = signer();
    engine.registerIdentity("key-giver", giver.pem);
    const input = {
      from: "key-giver",
      to: "key-recipient",
      product: "tea-a",
      merchant: "merchant-1",
      kind: "gift" as const,
      occasion: "birth",
      receipt: "receipt-1",
    };
    expect(() =>
      engine.acceptEdge({ ...input, signature: other.sign(input) })
    ).toThrow(/signature/);
  });

  test("the giver sees acts and never the gifts they answer", () => {
    const { engine } = makeEngine();
    const giver = signer();
    const recipient = signer();
    engine.registerIdentity("key-giver", giver.pem);
    engine.registerIdentity("key-recipient", recipient.pem);
    const gift = {
      from: "key-giver",
      to: "key-recipient",
      product: "tea-a",
      merchant: "merchant-1",
      kind: "gift" as const,
      occasion: "birth",
      receipt: "receipt-1",
    };
    engine.acceptEdge({ ...gift, signature: giver.sign(gift) });
    const thanks = {
      from: "key-recipient",
      to: "key-giver",
      product: "tea-a",
      merchant: "merchant-1",
      kind: "thanks" as const,
      occasion: "birth",
      receipt: "receipt-2",
    };
    engine.acceptEdge({ ...thanks, signature: recipient.sign(thanks) });

    const acts = engine.actsVisibleToGiver("key-giver");
    expect(acts.length).toBe(1);
    expect(acts[0]!.kind).toBe("thanks");
    for (const act of acts) {
      expect(Object.keys(act)).not.toContain("answers");
      expect(Object.keys(act)).not.toContain("responded");
    }
  });
});
