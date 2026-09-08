/**
 * Seeds a running engine with a catalogue and an attested key, and prints the
 * fixtures the conformance suites ask for.
 *
 * Everything here is deployment plumbing the specification does not describe,
 * which is exactly why the suites take the finished fixtures as environment
 * variables instead of calling these routes themselves.
 */
import { generateKeyPairSync, sign } from "node:crypto";
// The same people and merchants on every host. A second host seeded with
// fresh keys could not verify an edge that moved to it (import checks the
// giver's signature), so the first run prints its private keys and the
// harness hands them to the next run as SEED_KEYS.
import { createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";
const seedKeys: Record<string, string> = process.env.SEED_KEYS
  ? (JSON.parse(Buffer.from(process.env.SEED_KEYS, "base64").toString("utf8")) as Record<string, string>)
  : {};
function pairFor(name: string): { publicKey: KeyObject; privateKey: KeyObject } {
  if (!seedKeys[name]) {
    const fresh = generateKeyPairSync("ed25519");
    seedKeys[name] = fresh.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  }
  const privateKey = createPrivateKey(seedKeys[name]!);
  return { publicKey: createPublicKey(privateKey), privateKey };
}

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
    "tea-a": { merchant: "maker-a", ships: "carrier-a", price: 1200, physical: PHYSICAL },
    "tea-b": { merchant: "maker-a", ships: "carrier-a", price: 900, physical: PHYSICAL },
    "coffee-a": { merchant: "maker-a", ships: "carrier-a", price: 1500, physical: PHYSICAL },
    "miso-a": { merchant: "maker-a", ships: "carrier-a", price: 700, physical: PHYSICAL },
    "nori-a": { merchant: "maker-a", ships: "carrier-a", price: 1100, physical: PHYSICAL },
  },
});

// A second catalogue version, at a different price for the same product.
// §6.3 says a settlement uses the version stamped on the offer, and that is
// only checkable against a catalogue that has since moved.
// A second presenter, with its own catalogue and one offer of its own. Without
// it a merchant export that leaked every offer in the engine would look
// identical to one that leaked none, because there would be nothing to leak:
// measured 2026-09-09, when merchant_export_leaks_others failed no probe.
await post("/_presenter/configs", {
  version: "cfg-other-merchant",
  presenter: "other-merchant",
  products: {
    "salt-a": { merchant: "maker-b", ships: "carrier-b", price: 500, physical: PHYSICAL },
    "salt-b": { merchant: "maker-b", ships: "carrier-b", price: 600, physical: PHYSICAL },
  },
});
await post("/offers", {
  binding: "digital",
  household: "household-other",
  purpose: "replenish",
  config_version: "cfg-other-merchant",
  expires_at: Date.now() + 3_600_000,
  mandate: "mandate-conformance",
  price_band: null,
  giver: null,
  candidates: [
    { product: "salt-a", quantity: 1, predicted_conversion: 0.5, is_exploration: true },
    { product: "salt-b", quantity: 1, predicted_conversion: 0.5, is_exploration: true },
  ],
});

// §5. A narrower catalogue under the same presenter: what the presenter still
// has to offer is counted over every catalogue it registered, so an offer
// under this one cannot escape the floor by naming fewer products.
await post("/_presenter/configs", {
  version: "cfg-conformance-narrow",
  presenter: "reference-merchant",
  products: {
    "tea-a": { merchant: "maker-a", ships: "carrier-a", price: 1200, physical: PHYSICAL },
    "tea-b": { merchant: "maker-a", ships: "carrier-a", price: 900, physical: PHYSICAL },
  },
});

await post("/_presenter/configs", {
  version: "cfg-conformance-v2",
  presenter: "reference-merchant",
  products: {
    "tea-a": { merchant: "maker-a", ships: "carrier-a", price: 9900, physical: PHYSICAL },
    "tea-b": { merchant: "maker-a", ships: "carrier-a", price: 900, physical: PHYSICAL },
    "coffee-a": { merchant: "maker-a", ships: "carrier-a", price: 1500, physical: PHYSICAL },
    "miso-a": { merchant: "maker-a", ships: "carrier-a", price: 700, physical: PHYSICAL },
    "nori-a": { merchant: "maker-a", ships: "carrier-a", price: 1100, physical: PHYSICAL },
  },
});

const { publicKey, privateKey } = pairFor("giver");
const giver = "key-giver-conformance";
await post("/_presenter/identities", {
  key: giver,
  public_key: publicKey.export({ type: "spki", format: "pem" }).toString(),
  attested: true,
});

// §7.1. A key nobody's identity root endorsed. An edge signed with it is
// recorded and shown as unattested, and it makes nothing known to the
// household it names: anyone can register a key, so an unattested edge that
// counted would let a stranger empty somebody's exploration floor.
const stranger = pairFor("stranger");
await post("/_presenter/identities", {
  key: "key-stranger-conformance",
  public_key: stranger.publicKey.export({ type: "spki", format: "pem" }).toString(),
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
const onward = pairFor("onward");
await post("/_presenter/identities", {
  key: "key-recipient-conformance",
  public_key: onward.publicKey.export({ type: "spki", format: "pem" }).toString(),
  attested: true,
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
// clause 17. Without a thanks the giver's stream is empty, and every probe
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
  const pair = pairFor(`registry:${merchant}`);
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

// Clause 35. The key that confirms offers under the conformance mandate. The
// public half is registered here; the private half goes to the suite on the
// second output line, base64 of the PEM, so the probes can sign decisions.
const mandatePair = pairFor("mandate");
await post("/_presenter/identities", {
  key: "mandate-conformance",
  public_key: mandatePair.publicKey.export({ type: "spki", format: "pem" }).toString(),
  attested: true,
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
// §16. A mandate for the conformance household, with one co-signer: the
// probes raise and lower the ceiling to see which changes need whose
// signature. The household's own key doubles as the mandate key, which is
// what the engine already resolves for a signed decided set (§10.5).
const coSigner = pairFor("co-signer");
await post("/_presenter/identities", {
  key: "key-cosigner-conformance",
  public_key: coSigner.publicKey.export({ type: "spki", format: "pem" }).toString(),
  attested: true,
});
// The household's own key, under its own name: §16 has a mandate signed by
// the household, and §10.5 has a decided set signed by the key registered
// for the offer's mandate reference. The same key answers to both names here.
await post("/_presenter/identities", {
  key: "household-conformance",
  public_key: mandatePair.publicKey.export({ type: "spki", format: "pem" }).toString(),
  attested: true,
});
const baseMandate = {
  id: "mandate-conformance",
  household: "household-conformance",
  ceiling_out_of_network: 100000,
  co_signers: ["key-cosigner-conformance"],
  lapses_at: Date.now() + 365 * 86_400_000,
  version: 1,
};
const canonicalMandate = (m: typeof baseMandate) =>
  Buffer.from(
    [m.id, m.household, String(m.ceiling_out_of_network), [...m.co_signers].sort().join(","), String(m.lapses_at), String(m.version)].join("\n"),
    "utf8"
  );
await post("/_node/mandates", {
  ...baseMandate,
  signatures: {
    "household-conformance": sign(null, canonicalMandate(baseMandate), mandatePair.privateKey).toString("base64"),
  },
});

console.log(Buffer.from(JSON.stringify(seedKeys), "utf8").toString("base64"));
// §7.1. A well-formed edge from the unattested key, for the probes.
const strangerEdge = {
  from: "key-stranger-conformance",
  to: "household-conformance",
  product: "nori-a",
  merchant: "maker-a",
  kind: "gift" as const,
  occasion: "no occasion",
  receipt: "receipt-stranger",
};
console.log(
  JSON.stringify({
    ...strangerEdge,
    signature: sign(null, canonical(strangerEdge), stranger.privateKey).toString("base64"),
  })
);

console.log(
  Buffer.from(
    JSON.stringify({
      ...baseMandate,
      co_signer_key: Buffer.from(coSigner.privateKey.export({ type: "pkcs8", format: "pem" }).toString(), "utf8").toString("base64"),
    }),
    "utf8"
  ).toString("base64")
);
