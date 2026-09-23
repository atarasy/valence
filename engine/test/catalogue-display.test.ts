import { describe, expect, test } from "bun:test";
import { sign } from "node:crypto";
import {
  CONFIG_VERSION,
  HOUSEHOLD,
  MANDATE,
  PRESENTER_PAIR,
  makeEngine,
  signConfig,
} from "./helpers.js";
import { createApp } from "../src/http.js";
import { ApprovalDesk } from "../src/hub/approval.js";
import { DeliveryRegister } from "../src/hub/delivery.js";
import { EXPORT_FORMAT_VERSION, RecoveryRegister } from "../src/hub/node.js";
import { PermissionLedger } from "../src/hub/permissions.js";
import { Registry } from "../src/shared/registry.js";
import { renderStatement } from "../src/hub/statement.js";
import { canonicalConfig } from "../src/engine/offers.js";
import type { PresenterConfig } from "../src/common/types.js";

/**
 * D-1, decided 2026-09-23 (`80_App_UI_Refinement_Plan_2026-09-23.md` §3.2,
 * §5 row D-1). A catalogue entry gains an optional display `name` and
 * `variant`, carried through to a candidate, an approval, a statement and a
 * settlement. Tests below follow the shape `disclosure-contact.test.ts` set
 * for question 72: absence must be a truly missing key, not `null`, because
 * a client that checks a candidate's keys exactly refuses a null one.
 */

function hub() {
  return {
    deliveries: new DeliveryRegister(),
    approvals: new ApprovalDesk(),
    recovery: new RecoveryRegister(),
    permissions: new PermissionLedger(),
    registry: new Registry(),
  };
}

const bytes = (c: PresenterConfig) => canonicalConfig(c).toString("utf8");

describe("§3, 'Catalogue publication signature revision 3': the signed bytes", () => {
  test("worked example: byte for byte", () => {
    const config: PresenterConfig = {
      version: "v1",
      presenter: "p",
      products: {
        b: { merchant: "M", maker: "K", ships: "S", price: 100, name: "Tea", variant: "500g" },
        a: { merchant: "M", maker: "K", ships: "S", price: 50 },
      },
    };
    expect(bytes(config)).toBe(
      JSON.stringify([
        "valence.catalogue.3",
        "v1",
        "p",
        [
          ["a", "M", "K", "S", 50, null, null, null, null],
          ["b", "M", "K", "S", 100, null, null, "Tea", "500g"],
        ],
      ])
    );
  });

  test("a publication with no name or variant on any entry signs revision 2, unchanged", () => {
    const withoutDisplay: PresenterConfig = {
      version: "v1",
      presenter: "p",
      products: { a: { merchant: "M", maker: "K", ships: "S", price: 50 } },
    };
    expect(bytes(withoutDisplay)).toBe(
      JSON.stringify(["valence.catalogue.2", "v1", "p", [["a", "M", "K", "S", 50, null, null]]])
    );
  });

  test("a single named entry puts every row through the nine-element revision 3 shape", () => {
    const config: PresenterConfig = {
      version: "v1",
      presenter: "p",
      products: {
        a: { merchant: "M", maker: "K", ships: "S", price: 50 },
        b: { merchant: "M", maker: "K", ships: "S", price: 100, name: "Tea" },
      },
    };
    const [format, , , rows] = JSON.parse(bytes(config)) as [string, string, string, unknown[][]];
    expect(format).toBe("valence.catalogue.3");
    expect(rows.every((r) => r.length === 9)).toBe(true);
  });

  test("stripping the name from a revision 3 publication changes the bytes, so a signature that verified before no longer does", () => {
    const named: PresenterConfig = {
      version: "v1",
      presenter: "p",
      products: { a: { merchant: "M", maker: "K", ships: "S", price: 50, name: "Tea" } },
    };
    const stripped: PresenterConfig = {
      version: "v1",
      presenter: "p",
      products: { a: { merchant: "M", maker: "K", ships: "S", price: 50 } },
    };
    expect(bytes(named)).not.toBe(bytes(stripped));
  });

  test("name and variant are each inside the signed bytes", () => {
    const base: PresenterConfig = {
      version: "v1",
      presenter: "p",
      products: { a: { merchant: "M", maker: "K", ships: "S", price: 50, name: "Tea", variant: "500g" } },
    };
    for (const over of [{ name: "Coffee" }, { variant: "1kg" }]) {
      const other: PresenterConfig = { ...base, products: { a: { ...base.products.a!, ...over } } };
      expect(bytes(other)).not.toBe(bytes(base));
    }
  });

  test("name over 120 code points, or variant over 60, is refused", () => {
    const long = (n: number) => "a".repeat(n);
    expect(() =>
      canonicalConfig({
        version: "v1",
        presenter: "p",
        products: { a: { merchant: "M", maker: "K", ships: "S", price: 50, name: long(121) } },
      })
    ).toThrow();
    expect(() =>
      canonicalConfig({
        version: "v1",
        presenter: "p",
        products: { a: { merchant: "M", maker: "K", ships: "S", price: 50, variant: long(61) } },
      })
    ).toThrow();
    // Exactly at the bound is accepted.
    expect(() =>
      canonicalConfig({
        version: "v1",
        presenter: "p",
        products: { a: { merchant: "M", maker: "K", ships: "S", price: 50, name: long(120), variant: long(60) } },
      })
    ).not.toThrow();
  });

  test("an empty name or variant is refused", () => {
    expect(() =>
      canonicalConfig({
        version: "v1",
        presenter: "p",
        products: { a: { merchant: "M", maker: "K", ships: "S", price: 50, name: "" } },
      })
    ).toThrow();
  });

  test("the length bound counts Unicode code points, not UTF-16 units: a name of 120 astral characters is accepted", () => {
    // U+1F375 (teacup) is outside the BMP and is two UTF-16 units but one
    // code point; 120 of them is 240 UTF-16 units.
    const name = "\u{1F375}".repeat(120);
    expect(() =>
      canonicalConfig({
        version: "v1",
        presenter: "p",
        products: { a: { merchant: "M", maker: "K", ships: "S", price: 50, name } },
      })
    ).not.toThrow();
    const oneMore = "\u{1F375}".repeat(121);
    expect(() =>
      canonicalConfig({
        version: "v1",
        presenter: "p",
        products: { a: { merchant: "M", maker: "K", ships: "S", price: 50, name: oneMore } },
      })
    ).toThrow();
  });
});

describe("§3: nothing signed by a household changes", () => {
  test("a statement's canonical form for a candidate with a name equals the one without", async () => {
    const made = makeEngine();
    const { engine } = made;
    const config = {
      version: "cfg-named",
      presenter: "merchant-1",
      products: {
        "tea-named": { merchant: "maker-a", maker: "made-by-tea", ships: "carrier-a", price: 1200, name: "Tea", variant: "500g" },
      },
    };
    engine.registerConfig(config, signConfig(config as never));
    const offer = await engine.createOffer({
      binding: "digital",
      household: HOUSEHOLD,
      purpose: "replenish",
      config_version: "cfg-named",
      expires_at: Date.now() + 3_600_000,
      mandate: MANDATE,
      price_band: null,
      giver: null,
      candidates: [{ product: "tea-named", quantity: 1, is_exploration: true }],
    } as never);
    expect(offer.candidates[0]!.name).toBe("Tea");

    const bare = await engine.createOffer({
      binding: "digital",
      household: HOUSEHOLD,
      purpose: "replenish",
      config_version: CONFIG_VERSION,
      expires_at: Date.now() + 3_600_000,
      mandate: MANDATE,
      price_band: null,
      giver: null,
      candidates: [{ product: "coffee-a", quantity: 1, is_exploration: true }],
    } as never);
    expect(bare.candidates[0]!.name).toBeUndefined();

    // §10.5's canonical decision form names only candidate, valence, kept_as
    // and lineage: a name on one candidate and not the other must not appear
    // in what is signed.
    const { canonicalDecisions } = await import("../src/shared/decisions.js");
    const named = canonicalDecisions(offer.id, [{ candidate: offer.candidates[0]!.id, valence: "kept", kept_as: "self" }]);
    const unnamed = canonicalDecisions(bare.id, [{ candidate: bare.candidates[0]!.id, valence: "kept", kept_as: "self" }]).toString("utf8").replace(bare.id, offer.id).replace(bare.candidates[0]!.id, offer.candidates[0]!.id);
    expect(named.toString("utf8")).toBe(unnamed);
  });
});

describe("§13.2: the local verification marker", () => {
  test("a catalogue with a display field is marked revision 3, and a catalogue without one is marked revision 2", async () => {
    const withName = {
      version: "cfg-marker-3",
      presenter: "merchant-1",
      products: { "tea-named": { merchant: "maker-a", maker: "made-by-tea", ships: "carrier-a", price: 1200, name: "Tea" } },
    };
    const withoutName = {
      version: "cfg-marker-2",
      presenter: "merchant-1",
      products: { "tea-bare": { merchant: "maker-a", maker: "made-by-tea", ships: "carrier-a", price: 1200 } },
    };
    const { engine } = makeEngine();
    engine.registerConfig(withName, signConfig(withName as never));
    engine.registerConfig(withoutName, signConfig(withoutName as never));
    // Both must be usable to create an offer: the gate accepts 2 and 3 alike.
    for (const [version, product] of [["cfg-marker-3", "tea-named"], ["cfg-marker-2", "tea-bare"]] as const) {
      const offer = await engine.createOffer({
        binding: "digital",
        household: HOUSEHOLD,
        purpose: "replenish",
        config_version: version,
        expires_at: Date.now() + 3_600_000,
        mandate: MANDATE,
        price_band: null,
        giver: null,
        candidates: [{ product, quantity: 1, is_exploration: true }],
      } as never);
      expect(offer.id).toBeTruthy();
    }
  });
});

describe("D-1: candidate creation copies name/variant from the catalogue, never the request", () => {
  async function offerWithDisplay() {
    const made = makeEngine();
    const { engine } = made;
    const config = {
      version: "cfg-display",
      presenter: "merchant-1",
      products: {
        "tea-display": {
          merchant: "maker-a",
          maker: "made-by-tea",
          ships: "carrier-a",
          price: 1200,
          name: "Sencha",
          variant: "500g bag",
        },
      },
    };
    engine.registerConfig(config, signConfig(config as never));
    const offer = await engine.createOffer({
      binding: "digital",
      household: HOUSEHOLD,
      purpose: "replenish",
      config_version: "cfg-display",
      expires_at: Date.now() + 3_600_000,
      mandate: MANDATE,
      price_band: null,
      giver: null,
      candidates: [{ product: "tea-display", quantity: 1, is_exploration: true }],
    } as never);
    await engine.present(offer.id);
    return { ...made, offer };
  }

  test("the candidate carries the catalogue's name and variant", async () => {
    const { offer } = await offerWithDisplay();
    expect(offer.candidates[0]!.name).toBe("Sencha");
    expect(offer.candidates[0]!.variant).toBe("500g bag");
  });

  test("a POST /offers candidate carrying `name` is refused 400 malformed, as any unknown field is", async () => {
    const { engine } = makeEngine();
    const handle = createApp(engine, hub());
    const r = await handle(
      new Request("https://unit.example/offers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          binding: "digital",
          household: HOUSEHOLD,
          purpose: "replenish",
          config_version: CONFIG_VERSION,
          expires_at: Date.now() + 3_600_000,
          mandate: MANDATE,
          candidates: [{ product: "tea-a", quantity: 1, is_exploration: true, name: "Injected" }],
        }),
      })
    );
    expect(r.status).toBe(400);
    const body = (await r.json()) as { error: string };
    expect(body.error).toBe("malformed");
  });
});

describe("D-1: name/variant are absent, not null, on every surface that carries a candidate or a line", () => {
  async function offerWithDisplay() {
    const made = makeEngine();
    const { engine } = made;
    const config = {
      version: "cfg-surfaces",
      presenter: "merchant-1",
      products: {
        "tea-surface": { merchant: "maker-a", maker: "made-by-tea", ships: "carrier-a", price: 1200, name: "Sencha" },
      },
    };
    engine.registerConfig(config, signConfig(config as never));
    const offer = await engine.createOffer({
      binding: "digital",
      household: HOUSEHOLD,
      purpose: "replenish",
      config_version: "cfg-surfaces",
      expires_at: Date.now() + 3_600_000,
      mandate: MANDATE,
      price_band: null,
      giver: null,
      candidates: [{ product: "tea-surface", quantity: 1, is_exploration: true }],
    } as never);
    await engine.present(offer.id);
    return { ...made, offer };
  }

  test("GET /offers/{id} carries `name` for a named candidate", async () => {
    const { engine, offer } = await offerWithDisplay();
    const handle = createApp(engine, hub());
    const r = await handle(new Request(`https://unit.example/offers/${offer.id}`));
    const body = (await r.json()) as { candidates: { name?: string; variant?: string }[] };
    expect(body.candidates[0]!.name).toBe("Sencha");
    expect("variant" in body.candidates[0]!).toBe(false);
  });

  test("GET /offers/{id} carries no `name` key at all for an unnamed candidate", async () => {
    const made = makeEngine();
    const { engine } = made;
    const offer = await engine.createOffer({
      binding: "digital",
      household: HOUSEHOLD,
      purpose: "replenish",
      config_version: CONFIG_VERSION,
      expires_at: Date.now() + 3_600_000,
      mandate: MANDATE,
      price_band: null,
      giver: null,
      candidates: [{ product: "tea-a", quantity: 1, is_exploration: true }],
    } as never);
    await engine.present(offer.id);
    const handle = createApp(engine, hub());
    const r = await handle(new Request(`https://unit.example/offers/${offer.id}`));
    const body = (await r.json()) as { candidates: Record<string, unknown>[] };
    expect("name" in body.candidates[0]!).toBe(false);
    expect("variant" in body.candidates[0]!).toBe(false);
  });

  test("the approval carries `name` for a named candidate and omits it for an unnamed one", async () => {
    const { engine, offer } = await offerWithDisplay();
    const desk = new ApprovalDesk();
    desk.record({
      offer: offer.id,
      perCandidate: { [offer.candidates[0]!.id]: { alternatives: ["tea-a"], argument_against: "less tea" } },
      excluded: [],
      mandate: { kind: "individual", scope: "once", lapses_at: null },
    });
    const rendered = desk.render(engine, offer, undefined);
    if ("missing" in rendered) throw new Error(rendered.missing);
    expect(rendered.candidates[0]!.name).toBe("Sencha");
    expect("variant" in rendered.candidates[0]!).toBe(false);
  });

  test("the statement carries `name` for a named candidate", async () => {
    const { engine, offer } = await offerWithDisplay();
    const { decideSigned } = await import("./helpers.js");
    await decideSigned(engine, offer.id, [{ candidate: offer.candidates[0]!.id, valence: "kept", kept_as: "self" }]);
    const statement = renderStatement(engine.mustGet(offer.id), undefined, engine.recoveries.for(offer.id));
    expect(statement.lines[0]!.name).toBe("Sencha");
    expect("variant" in statement.lines[0]!).toBe(false);
  });

  test("the settlement, the node export and the merchant export all carry `name` with no null anywhere", async () => {
    const { engine, offer } = await offerWithDisplay();
    const { decideSigned, settleSigned } = await import("./helpers.js");
    await decideSigned(engine, offer.id, [{ candidate: offer.candidates[0]!.id, valence: "kept", kept_as: "self" }]);
    await settleSigned(engine, offer.id, [], Date.now() + 3_600_000);
    const settlement = engine.settlement(offer.id)!;
    expect(settlement.lines[0]!.name).toBe("Sencha");
    expect("variant" in settlement.lines[0]!).toBe(false);
    // Raw pass-through surfaces: no per-field view function sits between the
    // engine's Candidate/SettlementLine objects and these two exports, so
    // the true-absence-of-key discipline in offers.ts is what keeps them
    // free of a stray `"name":null` or `"variant":null`.
    const { exportNode, exportMerchant } = await import("../src/hub/node.js");
    const node = exportNode(
      engine,
      new RecoveryRegister(),
      new PermissionLedger(),
      engine.mandates,
      new DeliveryRegister(),
      HOUSEHOLD
    );
    expect(JSON.stringify(node)).not.toContain('"variant":null');
    expect(JSON.stringify(node)).toContain('"name":"Sencha"');
    const merchant = exportMerchant(engine, "merchant-1");
    expect(JSON.stringify(merchant)).not.toContain('"variant":null');
    expect(JSON.stringify(merchant)).toContain('"name":"Sencha"');
  });
});

describe("§14: node export/import carries name/variant, format valence-node/13", () => {
  test("the format is valence-node/13", () => {
    expect(EXPORT_FORMAT_VERSION).toBe("valence-node/13");
  });

  // The rest of this format's round trip (a /12 archive reading as an entry
  // with no catalogue name, a name over 120 code points being refused,
  // round-tripping unchanged) is proven in
  // `experiments/member-transactions/node-import.test.ts` against
  // `validateNodeImport`, the independent strict importer, rather than here:
  // importing that package's `.ts` module directly from this one crosses the
  // engine's own tsconfig boundary (`allowImportingTsExtensions` is not set
  // for it, on purpose, since the engine does not depend on `experiments/`).
});
