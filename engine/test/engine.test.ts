import { describe, expect, test } from "bun:test";
import { ValenceEngine, explorationFloor } from "../src/engine.js";
import { InMemoryLedger } from "../src/ledger.js";
import { ValenceError } from "../src/errors.js";
import { CONFIG_VERSION, HOUR, makeEngine, signer } from "./helpers.js";

const baseOffer = (candidates: {
  product: string;
  quantity?: number;
  predicted_conversion?: number | null;
  is_exploration?: boolean;
}[], overrides: Record<string, unknown> = {}) => ({
  binding: "digital" as const,
  household: "house-1",
  purpose: "replenish" as const,
  config_version: CONFIG_VERSION,
  expires_at: Date.now() + HOUR,
  mandate: "mandate-1",
  candidates: candidates.map((c) => ({
    product: c.product,
    quantity: c.quantity ?? 1,
    predicted_conversion: c.predicted_conversion ?? 0.5,
    is_exploration: c.is_exploration ?? false,
  })),
  ...overrides,
});

describe("construction", () => {
  test("refuses an exploration rate of zero", () => {
    expect(
      () =>
        new ValenceEngine(new InMemoryLedger(), {
          explorationRate: 0,
          explorationThreshold: 0.2,
          reminderLimit: 1,
          recoveryGraceDays: 3,
        })
    ).toThrow(/greater than zero/);
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

  test("a well-predicted, already-known product cannot pad the floor", () => {
    const { engine } = makeEngine();
    expect(() =>
      engine.createOffer(
        baseOffer([
          { product: "tea-a" },
          { product: "tea-b", is_exploration: true, predicted_conversion: 0.9 },
        ])
      )
    ).not.toThrow();
    // tea-b was never kept by this household, so it is unknown and qualifies.
    // Once kept, the same candidate no longer qualifies.
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
    engine.registerConfig({
      version: "cfg-2",
      presenter: "merchant-1",
      products: { "tea-a": { price: 9900, cost: 400 }, "tea-b": { price: 900, cost: 300 } },
    });
    engine.decide(offer.id, [
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
        { purpose: "ceremonial", expires_at: now + 1000 }
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
    const { engine } = makeEngine();
    const offer = engine.createOffer(
      baseOffer(
        [
          { product: "tea-a" },
          { product: "tea-b", is_exploration: true, predicted_conversion: 0.05 },
        ],
        { binding: "physical" }
      )
    );
    await engine.present(offer.id);
    engine.decide(offer.id, [
      { candidate: offer.candidates[0]!.id, valence: "lost" },
      { candidate: offer.candidates[1]!.id, valence: "consumed" },
    ]);
    const settlement = await engine.settle(offer.id);
    expect(settlement.lost_amount).toBe(1200);
    expect(settlement.kept_amount).toBe(0);
    expect(settlement.consumed_amount).toBe(300);
  });

  test("consumed settles at cost, not price", async () => {
    const { engine } = makeEngine();
    const offer = engine.createOffer(
      baseOffer(
        [
          { product: "coffee-a" },
          { product: "tea-b", is_exploration: true, predicted_conversion: 0.05 },
        ],
        { binding: "physical" }
      )
    );
    await engine.present(offer.id);
    engine.decide(offer.id, [
      { candidate: offer.candidates[0]!.id, valence: "consumed" },
    ]);
    engine.decide(offer.id, [
      { candidate: offer.candidates[1]!.id, valence: "returned" },
    ]);
    const settlement = await engine.settle(offer.id);
    expect(settlement.consumed_amount).toBe(600);
  });

  test("consumed and lost do not exist in the digital binding", async () => {
    const { engine } = makeEngine();
    const offer = engine.createOffer(
      baseOffer([
        { product: "tea-a" },
        { product: "tea-b", is_exploration: true, predicted_conversion: 0.05 },
      ])
    );
    await engine.present(offer.id);
    expect(() =>
      engine.decide(offer.id, [
        { candidate: offer.candidates[0]!.id, valence: "consumed" },
      ])
    ).toThrow(/physical binding/);
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
    engine.decide(offer.id, [
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
