import { generateKeyPairSync, sign } from "node:crypto";
import { ValenceEngine, canonicalConfig } from "../src/engine/offers.js";
import { InMemoryLedger } from "../src/engine/ledger.js";
import { canonical, type EdgeInput } from "../src/shared/lineage.js";
import { canonicalDecisions, type DecisionInput } from "../src/shared/decisions.js";
import { canonicalDisclosure } from "../src/shared/disclosure.js";

/** Clause 35. The key the unit tests confirm with, registered for "mandate-1". */
export const MANDATE_PAIR = generateKeyPairSync("ed25519");

export async function decideSigned(engine: ValenceEngine, offerId: string, decisions: DecisionInput[]) {
  const signature = sign(null, canonicalDecisions(offerId, decisions), MANDATE_PAIR.privateKey).toString("base64");
  return await engine.decide(offerId, decisions, signature);
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
export function disclosureFor(merchant: string) {
  const body = {
    merchant,
    version: "d-1",
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
  return { engine, ledger };
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
