import { generateKeyPairSync, sign } from "node:crypto";
import { ValenceEngine } from "../src/engine.js";
import { InMemoryLedger } from "../src/ledger.js";
import { canonical, type EdgeInput } from "../src/lineage.js";

export const CONFIG_VERSION = "cfg-1";

export function makeEngine(overrides: Partial<{
  explorationRate: number;
  explorationThreshold: number;
  reminderLimit: 0 | 1;
}> = {}) {
  const ledger = new InMemoryLedger();
  const engine = new ValenceEngine(ledger, {
    explorationRate: 0.2,
    explorationThreshold: 0.2,
    reminderLimit: 1,
    ...overrides,
  });
  engine.registerConfig({
    version: CONFIG_VERSION,
    presenter: "merchant-1",
    products: {
      "tea-a": { price: 1200, cost: 400 },
      "tea-b": { price: 900, cost: 300 },
      "coffee-a": { price: 1500, cost: 600 },
      "miso-a": { price: 700, cost: 250 },
      "nori-a": { price: 1100, cost: 380 },
    },
  });
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
