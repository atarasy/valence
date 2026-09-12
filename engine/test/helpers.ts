import { generateKeyPairSync, sign } from "node:crypto";
import { ValenceEngine, canonicalConfig } from "../src/engine/offers.js";
import { InMemoryLedger } from "../src/engine/ledger.js";
import { canonical, type EdgeInput } from "../src/shared/lineage.js";
import { canonicalDecisions, type DecisionInput } from "../src/shared/decisions.js";
import { canonicalDisclosure } from "../src/shared/disclosure.js";
import { canonicalStatement, statementLines } from "../src/shared/statement.js";
import { DeliveryRegister } from "../src/hub/delivery.js";
import { LocalDeliveries } from "../src/engine/delivery-source.js";

/** Clause 35. The key the unit tests confirm with, registered for "mandate-1". */
export const MANDATE_PAIR = generateKeyPairSync("ed25519");

export async function decideSigned(engine: ValenceEngine, offerId: string, decisions: DecisionInput[]) {
  const signature = sign(null, canonicalDecisions(offerId, decisions), MANDATE_PAIR.privateKey).toString("base64");
  return await engine.decide(offerId, decisions, signature);
}

/**
 * §6.5. Settle a physical box the household confirms: the statement the
 * collection's record proposes, with `disputed` lines marked, signed as the
 * mandate. Question 36.
 */
export async function settleSigned(
  engine: ValenceEngine,
  offerId: string,
  disputed: string[] = [],
  now = Date.now()
) {
  const offer = engine.mustGet(offerId, now);
  const lines = statementLines(offer, disputed);
  // §6.5, question 40. The carriage is inside the bytes, and the helper reads
  // it where the screen does rather than being told it, so a test that records
  // a different figure signs the figure it recorded.
  const carried = await engine.deliveryFor(offerId);
  const signature = sign(null, canonicalStatement(offerId, carried ? carried.carriage : 0, lines), MANDATE_PAIR.privateKey).toString("base64");
  return await engine.settle(offerId, now, { signed: { signature }, disputed });
}

export const CONFIG_VERSION = "cfg-1";

export const PHYSICAL = { ambient: true, keeps_for_days: 365, fits_ten_per_container: true, regulated: false };

/** §5.4. The presenter key the unit tests publish catalogues with. */
export const PRESENTER_PAIR = generateKeyPairSync("ed25519");
export const MERCHANT_PAIR = generateKeyPairSync("ed25519");

/**
 * §10a. A block the merchant composed. **The contents say nothing about what
 * any statute wants**, because the engine reads no item: what a seller must
 * disclose is the seller's law, and a fixture that pretended otherwise would
 * assert something this codebase cannot check.
 */
export function disclosureFor(merchant: string, product: string | null = null) {
  const body = {
    merchant,
    product,
    version: product === null ? "d-1" : `d-1-${product}`,
    items: [
      { label: "payment", value: "charged when the household confirms" },
      { label: "delivery", value: "already placed" },
      { label: "returns", value: "as the merchant published" },
    ],
  };
  return {
    ...body,
    signature: sign(null, canonicalDisclosure(body), MERCHANT_PAIR.privateKey).toString("base64"),
  };
}

export function signConfig(config: Parameters<typeof canonicalConfig>[0]): string {
  return sign(null, canonicalConfig(config), PRESENTER_PAIR.privateKey).toString("base64");
}

export function makeEngine(overrides: Partial<{
  explorationRate: number;
  reminderLimit: 0 | 1;
  relyingPartyId: string;
}> = {}) {
  const ledger = new InMemoryLedger();
  // §7.5b, §13.1. The register is the hub's and the screens are answered under
  // an offer's path, so the engine is pointed at it exactly as `server.ts`
  // points a deployment at its own.
  const deliveries = new DeliveryRegister();
  const engine = new ValenceEngine(ledger, {
    explorationRate: 0.2,
    reminderLimit: 1,
    recoveryGraceDays: 3,
    relyingPartyId: "unit.example",
    ...overrides,
  });
  // §5.4. A catalogue is signed by the presenter it names.
  const presenterPair = PRESENTER_PAIR;
  engine.registerIdentity(
    "merchant-1",
    presenterPair.publicKey.export({ type: "spki", format: "pem" }).toString(),
    true
  );
  const config = {
    version: CONFIG_VERSION,
    presenter: "merchant-1",
    products: {
      // §11.1. Ambient, long-keeping, ten to a container, unregulated: the
      // band the physical binding can carry.
      "tea-a": { merchant: "maker-a", maker: "made-by-tea", ships: "carrier-a", price: 1200, physical: PHYSICAL },
      "tea-b": { merchant: "maker-a", maker: "made-by-tea", ships: "carrier-a", price: 900, physical: PHYSICAL },
      "coffee-a": { merchant: "maker-a", maker: "made-by-tea", ships: "carrier-a", price: 1500, physical: PHYSICAL },
      "miso-a": { merchant: "maker-a", maker: "made-by-tea", ships: "carrier-a", price: 700, physical: PHYSICAL },
      "nori-a": { merchant: "maker-a", maker: "made-by-tea", ships: "carrier-a", price: 1100, physical: PHYSICAL },
    },
  };
  engine.registerConfig(config, signConfig(config));
  engine.registerIdentity("mandate-1", MANDATE_PAIR.publicKey.export({ type: "spki", format: "pem" }).toString());
  // §10a. Every merchant named on a candidate needs one, or a decision naming
  // it is refused. The fixture's merchant is `maker-a`, which is not the
  // presenter: the block belongs to the party that sells, not to the party
  // that composed the offer.
  engine.registerIdentity(
    "maker-a",
    MERCHANT_PAIR.publicKey.export({ type: "spki", format: "pem" }).toString()
  );
  engine.putDisclosure(disclosureFor("maker-a"));
  engine.readDeliveriesFrom(new LocalDeliveries(deliveries));
  return { engine, ledger, deliveries };
}

export function signer() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
  return {
    pem,
    sign(edge: EdgeInput): string {
      return sign(null, canonical(edge), privateKey).toString("base64");
    },
  };
}

export const HOUR = 3600_000;
