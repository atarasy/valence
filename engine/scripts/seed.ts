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
import { canonicalEntry } from "../src/registry.js";

const base = process.env.BASE ?? "http://localhost:8788";

// §11.1. Every seeded product is ambient, long-keeping, small and unregulated,
// so the physical binding can carry all of them and the probes can choose.
const PHYSICAL = {
  ambient: true,
  keeps_for_days: 365,
  fits_ten_per_container: true,
  regulated: false,
};

const post = async (path: string, body: unknown) => {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // The seed is the reference implementation's own tooling, so it says so.
      // Left as Bun's default, a mutation that discriminates on the client
      // rejected the seed's own lineage post and the run died before any probe
      // executed, which reads in the log as a mutation nothing caught.
      "user-agent": "atarasy-reference/0.0.0",
    },
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
    "tea-a": { merchant: "maker-a", ships: "carrier-a", price: 1200, cost: 400, physical: PHYSICAL },
    "tea-b": { merchant: "maker-a", ships: "carrier-a", price: 900, cost: 300, physical: PHYSICAL },
    "coffee-a": { merchant: "maker-a", ships: "carrier-a", price: 1500, cost: 600, physical: PHYSICAL },
    "miso-a": { merchant: "maker-a", ships: "carrier-a", price: 700, cost: 250, physical: PHYSICAL },
    "nori-a": { merchant: "maker-a", ships: "carrier-a", price: 1100, cost: 380, physical: PHYSICAL },
  },
});

// A second catalogue version, at a different price for the same product.
// §6.3 says a settlement uses the version stamped on the offer, and that is
// only checkable against a catalogue that has since moved.
// §5. A narrower catalogue under the same presenter: what the presenter still
// has to offer is counted over every catalogue it registered, so an offer
// under this one cannot escape the floor by naming fewer products.
await post("/_presenter/configs", {
  version: "cfg-conformance-narrow",
  presenter: "reference-merchant",
  products: {
    "tea-a": { merchant: "maker-a", ships: "carrier-a", price: 1200, cost: 400, physical: PHYSICAL },
    "tea-b": { merchant: "maker-a", ships: "carrier-a", price: 900, cost: 300, physical: PHYSICAL },
  },
});

await post("/_presenter/configs", {
  version: "cfg-conformance-v2",
  presenter: "reference-merchant",
  products: {
    "tea-a": { merchant: "maker-a", ships: "carrier-a", price: 9900, cost: 400, physical: PHYSICAL },
    "tea-b": { merchant: "maker-a", ships: "carrier-a", price: 900, cost: 300, physical: PHYSICAL },
    "coffee-a": { merchant: "maker-a", ships: "carrier-a", price: 1500, cost: 600, physical: PHYSICAL },
    "miso-a": { merchant: "maker-a", ships: "carrier-a", price: 700, cost: 250, physical: PHYSICAL },
    "nori-a": { merchant: "maker-a", ships: "carrier-a", price: 1100, cost: 380, physical: PHYSICAL },
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

// A second edge, one hop further out: the recipient gives to a third party.
//
// Without it the graph is a single edge and there is no second degree to
// expand into, so a probe that checks the circle does not walk past direct
// edges passes against an implementation that would. The chain is deployment
// plumbing, so the seed posts it rather than the suite building it.
const onward = generateKeyPairSync("ed25519");
await post("/_presenter/identities", {
  key: "key-recipient-conformance",
  public_key: onward.publicKey.export({ type: "spki", format: "pem" }).toString(),
});
const secondHop = {
  from: "key-recipient-conformance",
  to: "key-third-party-conformance",
  product: "tea-b",
  merchant: "reference-merchant",
  kind: "gift" as const,
  occasion: "thanks",
  receipt: "receipt-conformance-2",
};
await post("/lineage", {
  ...secondHop,
  signature: sign(null, canonical(secondHop), onward.privateKey).toString("base64"),
});

// An act, so the giver's surface has something on it.
//
// Both edges above are gifts, and gifts are excluded from the acts stream by
// clause 20. Without a thanks the giver's stream is empty, and every probe
// about what it does or does not disclose compares two empty responses.
const thanks = {
  from: "key-recipient-conformance",
  to: giver,
  product: "tea-a",
  merchant: "reference-merchant",
  kind: "thanks" as const,
  occasion: "birth",
  receipt: "receipt-conformance-3",
};
await post("/lineage", {
  ...thanks,
  signature: sign(null, canonical(thanks), onward.privateKey).toString("base64"),
});

// §15. Two registry entries, one carrying the mark and one not, so the
// probes can check that the mark is recorded and never a gate. Their keys are
// chosen so that key order and registration order disagree: "b-merchant" is
// registered first and must still come second.
for (const [merchant, mark] of [["b-merchant-no-mark", false], ["a-merchant-marked", true]] as const) {
  const pair = generateKeyPairSync("ed25519");
  await post("/registry/attest", {
    merchant,
    public_key: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
  });
  const entry = {
    merchant,
    endpoints: { valence: `https://${merchant}.example/valence`, acp: `https://${merchant}.example/acp` },
    mark,
  };
  await post("/registry", {
    ...entry,
    signature: sign(null, canonicalEntry(entry), pair.privateKey).toString("base64"),
  });
}

// Clause 39. The key that confirms offers under the conformance mandate. The
// public half is registered here; the private half goes to the suite on the
// second output line, base64 of the PEM, so the probes can sign decisions.
const mandatePair = generateKeyPairSync("ed25519");
await post("/_presenter/identities", {
  key: "mandate-conformance",
  public_key: mandatePair.publicKey.export({ type: "spki", format: "pem" }).toString(),
});

console.log(
  JSON.stringify({
    ...edge,
    signature: sign(null, canonical(edge), privateKey).toString("base64"),
  })
);
console.log(
  Buffer.from(mandatePair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(), "utf8").toString("base64")
);
