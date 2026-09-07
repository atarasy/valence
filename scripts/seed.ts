/**
 * Seeds a running engine with a catalogue and an attested key, and prints the
 * fixtures the conformance suites ask for.
 *
 * Everything here is deployment plumbing the specification does not describe,
 * which is exactly why the suites take the finished fixtures as environment
 * variables instead of calling these routes themselves.
 */
import { generateKeyPairSync, sign } from "node:crypto";
import { canonical } from "../src/lineage.js";

const base = process.env.BASE ?? "http://localhost:8788";

const post = async (path: string, body: unknown) => {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${path} -> ${response.status} ${await response.text()}`);
  }
  return response.json();
};

await post("/_presenter/configs", {
  version: "cfg-conformance",
  presenter: "reference-merchant",
  products: {
    "tea-a": { price: 1200, cost: 400 },
    "tea-b": { price: 900, cost: 300 },
    "coffee-a": { price: 1500, cost: 600 },
    "miso-a": { price: 700, cost: 250 },
    "nori-a": { price: 1100, cost: 380 },
  },
});

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const giver = "key-giver-conformance";
await post("/_presenter/identities", {
  key: giver,
  public_key: publicKey.export({ type: "spki", format: "pem" }).toString(),
});

const edge = {
  from: giver,
  to: "key-recipient-conformance",
  product: "tea-a",
  merchant: "reference-merchant",
  kind: "gift" as const,
  occasion: "birth",
  receipt: "receipt-conformance-1",
};

console.log(
  JSON.stringify({
    ...edge,
    signature: sign(null, canonical(edge), privateKey).toString("base64"),
  })
);
