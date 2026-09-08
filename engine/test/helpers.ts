import { generateKeyPairSync, sign } from "node:crypto";
import { ValenceEngine } from "../src/engine.js";
import { InMemoryLedger } from "../src/ledger.js";
import { canonical, type EdgeInput } from "../src/lineage.js";
import { canonicalDecisions, type DecisionInput } from "../src/mandate.js";

/** Clause 39. The key the unit tests confirm with, registered for "mandate-1". */
export const MANDATE_PAIR = generateKeyPairSync("ed25519");

export function decideSigned(engine: ValenceEngine, offerId: string, decisions: DecisionInput[]) {
  const signature = sign(null, canonicalDecisions(offerId, decisions), MANDATE_PAIR.privateKey).toString("base64");
  return engine.decide(offerId, decisions, signature);
}

export const CONFIG_VERSION = "cfg-1";

export const PHYSICAL = { ambient: true, keeps_for_days: 365, fits_ten_per_container: true, regulated: false };

export function makeEngine(overrides: Partial<{
  explorationRate: number;
  reminderLimit: 0 | 1;
}> = {}) {
  const ledger = new InMemoryLedger();
  const engine = new ValenceEngine(ledger, {
    explorationRate: 0.2,
    reminderLimit: 1,
    recoveryGraceDays: 3,
    ...overrides,
  });
  engine.registerConfig({
    version: CONFIG_VERSION,
    presenter: "merchant-1",
    products: {
      // §11.1. Ambient, long-keeping, ten to a container, unregulated: the
      // band the physical binding can carry.
      "tea-a": { merchant: "maker-a", ships: "carrier-a", price: 1200, physical: PHYSICAL },
      "tea-b": { merchant: "maker-a", ships: "carrier-a", price: 900, physical: PHYSICAL },
      "coffee-a": { merchant: "maker-a", ships: "carrier-a", price: 1500, physical: PHYSICAL },
      "miso-a": { merchant: "maker-a", ships: "carrier-a", price: 700, physical: PHYSICAL },
      "nori-a": { merchant: "maker-a", ships: "carrier-a", price: 1100, physical: PHYSICAL },
    },
  });
  engine.registerIdentity("mandate-1", MANDATE_PAIR.publicKey.export({ type: "spki", format: "pem" }).toString());
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
