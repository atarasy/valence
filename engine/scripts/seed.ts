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

import { canonical } from "../src/shared/lineage.js";
import { canonicalEntry } from "../src/shared/registry.js";
import { ownerOf } from "../src/common/roles.js";

const base = process.env.BASE ?? "http://localhost:8788";
// §13.1. When the pair being seeded presents one role each, every write has to
// reach the party that answers for it. Unset means one party answers for
// everything, which is what the reference runs.
const hubBase = process.env.HUB_BASE ?? base;
/**
 * Where a write belongs. A route one role owns goes to that party. A route
 * neither owns goes to **both**, because neutral state is not a copy one party
 * lends the other: both roles verify signatures, so both need the keys, and
 * both may answer for the registry.
 */
const basesFor = (path: string): string[] => {
  const owner = ownerOf(path.split("/").filter(Boolean));
  if (owner === "hub") return [hubBase];
  if (owner === "engine") return [base];
  return base === hubBase ? [base] : [base, hubBase];
};

// §11.1. Every seeded product is ambient, long-keeping, small and unregulated,
// so the physical binding can carry all of them and the probes can choose.
const PHYSICAL = {
  ambient: true,
  keeps_for_days: 365,
  fits_ten_per_container: true,
  regulated: false,
};

const post = async (path: string, body: unknown) => {
  const targets = basesFor(path);
  const response = await fetch(`${targets[0]!}${path}`, {
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
  // The same write to the other party, where the route is neither role's. The
  // answer returned is the first party's: they are the same write and the
  // caller has no use for two copies of it.
  for (const other of targets.slice(1)) {
    const second = await fetch(`${other}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "valence-seed" },
      body: JSON.stringify(body),
    });
    if (!second.ok) {
      throw new Error(`${path} (second party) -> ${second.status} ${await second.text()}`);
    }
  }
  return response.json();
};


// §5.4. A catalogue is signed by the presenter it names. The reference
// presenter's key is root-endorsed; the second one's is not, which is what a
// rename looks like from outside: a new identity, visibly not the same one.
const canonicalConfig = (c: { version: string; presenter: string; products: Record<string, { merchant: string; maker: string; ships: string; price: number; category?: string }> }) =>
  Buffer.from(
    [
      c.version,
      c.presenter,
      ...Object.keys(c.products).sort().map((ref) => {
        const e = c.products[ref]!;
        return [ref, e.merchant, e.maker, e.ships, String(e.price), e.category ?? ""].join(":");
      }),
    ].join("\n"),
    "utf8"
  );
const presenterKeys: Record<string, ReturnType<typeof pairFor>> = {
  "reference-merchant": pairFor("presenter:reference-merchant"),
  "other-merchant": pairFor("presenter:other-merchant"),
};
for (const [name, pair] of Object.entries(presenterKeys)) {
  await post("/_identities", {
    key: name,
    public_key: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
    attested: name === "reference-merchant",
  });
}
const postConfig = async (config: Parameters<typeof canonicalConfig>[0] & Record<string, unknown>) =>
  post("/_presenter/configs", {
    ...config,
    signature: sign(null, canonicalConfig(config), presenterKeys[config.presenter]!.privateKey).toString("base64"),
  });

await postConfig({
  version: "cfg-conformance",
  presenter: "reference-merchant",
  products: {
    // §16.4. The categories are the merchant's own words. The fixture needs
    // two that differ so a mandate can name one of them and leave the other
    // alone; nothing here interprets either.
    "tea-a": { merchant: "maker-a", maker: "made-by-tea", ships: "carrier-a", price: 1200, category: "tea", physical: PHYSICAL },
    "tea-b": { merchant: "maker-a", maker: "made-by-tea", ships: "carrier-a", price: 900, category: "tea", physical: PHYSICAL },
    "coffee-a": { merchant: "maker-a", maker: "made-by-coffee", ships: "carrier-a", price: 1500, category: "coffee", physical: PHYSICAL },
    "miso-a": { merchant: "maker-a", maker: "made-by-miso", ships: "carrier-a", price: 700, category: "seasoning", physical: PHYSICAL },
    "nori-a": { merchant: "maker-a", maker: "made-by-nori", ships: "carrier-a", price: 1100, category: "seasoning", physical: PHYSICAL },
  },
});

// A second catalogue version, at a different price for the same product.
// §6.3 says a settlement uses the version stamped on the offer, and that is
// only checkable against a catalogue that has since moved.
// A second presenter, with its own catalogue and one offer of its own. Without
// it a merchant export that leaked every offer in the engine would look
// identical to one that leaked none, because there would be nothing to leak:
// measured 2026-09-09, when merchant_export_leaks_others failed no probe.
await postConfig({
  version: "cfg-other-merchant",
  presenter: "other-merchant",
  products: {
    "salt-a": { merchant: "maker-b", maker: "made-by-salt", ships: "carrier-b", price: 500, physical: PHYSICAL },
    "salt-b": { merchant: "maker-b", maker: "made-by-salt", ships: "carrier-b", price: 600, physical: PHYSICAL },
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
await postConfig({
  version: "cfg-conformance-narrow",
  presenter: "reference-merchant",
  products: {
    "tea-a": { merchant: "maker-a", maker: "made-by-tea", ships: "carrier-a", price: 1200, physical: PHYSICAL },
    "tea-b": { merchant: "maker-a", maker: "made-by-tea", ships: "carrier-a", price: 900, physical: PHYSICAL },
  },
});

await postConfig({
  version: "cfg-conformance-v2",
  presenter: "reference-merchant",
  products: {
    "tea-a": { merchant: "maker-a", maker: "made-by-tea", ships: "carrier-a", price: 9900, physical: PHYSICAL },
    "tea-b": { merchant: "maker-a", maker: "made-by-tea", ships: "carrier-a", price: 900, physical: PHYSICAL },
    "coffee-a": { merchant: "maker-a", maker: "made-by-coffee", ships: "carrier-a", price: 1500, physical: PHYSICAL },
    "miso-a": { merchant: "maker-a", maker: "made-by-miso", ships: "carrier-a", price: 700, physical: PHYSICAL },
    "nori-a": { merchant: "maker-a", maker: "made-by-nori", ships: "carrier-a", price: 1100, physical: PHYSICAL },
  },
});

const { publicKey, privateKey } = pairFor("giver");
const giver = "key-giver-conformance";
await post("/_identities", {
  key: giver,
  public_key: publicKey.export({ type: "spki", format: "pem" }).toString(),
  attested: true,
});

// §7.1. A key nobody's identity root endorsed. An edge signed with it is
// recorded and shown as unattested, and it makes nothing known to the
// household it names: anyone can register a key, so an unattested edge that
// counted would let a stranger empty somebody's exploration floor.
const stranger = pairFor("stranger");
await post("/_identities", {
  key: "key-stranger-conformance",
  public_key: stranger.publicKey.export({ type: "spki", format: "pem" }).toString(),
});

const edge = {
  from: giver,
  to: "key-recipient-conformance",
  product: "tea-a",
  merchant: "reference-merchant",
  maker: "made-by-tea",
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
await post("/_identities", {
  key: "key-recipient-conformance",
  public_key: onward.publicKey.export({ type: "spki", format: "pem" }).toString(),
  attested: true,
});
const secondHop = {
  from: "key-recipient-conformance",
  to: "key-third-party-conformance",
  product: "tea-b",
  merchant: "reference-merchant",
  maker: "made-by-tea",
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
  maker: "made-by-tea",
  kind: "thanks" as const,
  occasion: "birth",
  receipt: "receipt-conformance-3",
};
await post("/lineage", {
  ...thanks,
  signature: sign(null, canonical(thanks), onward.privateKey).toString("base64"),
});

// §15. Two registry entries, one carrying the mark and one not, so the
// probes can check that the mark is recorded and never a gate. Three orders
// have to disagree here, and the names carry all three. Key order and
// registration order disagree, because "b-merchant" is registered first and
// must still come second. **And key order disagrees with mark-first order**:
// the unmarked entry sorts first, so a registry that quietly put the marked
// ones at the top would change the list. Until 2026-09-11 the marked entry
// was the one named "a-", which made those two orders identical and let
// `registry_sorts_by_the_mark` pass the key-order probe untouched.
for (const [merchant, mark] of [["b-merchant-marked", true], ["a-merchant-no-mark", false]] as const) {
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
await post("/_identities", {
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
await post("/_identities", {
  key: "key-cosigner-conformance",
  public_key: coSigner.publicKey.export({ type: "spki", format: "pem" }).toString(),
  attested: true,
});
// The household's own key, under its own name: §16 has a mandate signed by
// the household, and §10.5 has a decided set signed by the key registered
// for the offer's mandate reference. The same key answers to both names here.
await post("/_identities", {
  key: "household-conformance",
  public_key: mandatePair.publicKey.export({ type: "spki", format: "pem" }).toString(),
  attested: true,
});
const baseMandate = {
  id: "mandate-conformance",
  household: "household-conformance",
  ceiling_out_of_network: 100000,
  // §16. The fixture leaves the two protections of 2026-09-10 unset, so the
  // suites that do not care about them see the mandate they always saw. The
  // probes that do care sign their own versions. There were three until
  // 2026-09-12, when the per-purchase second signature was removed.
  ceiling_daily: null as number | null,
  cooling_seconds: null as number | null,
  co_signers: ["key-cosigner-conformance"],
  lapses_at: Date.now() + 365 * 86_400_000,
  version: 1,
};
const canonicalMandate = (m: typeof baseMandate) =>
  Buffer.from(
    [
      m.id,
      m.household,
      String(m.ceiling_out_of_network),
      m.ceiling_daily === null ? "" : String(m.ceiling_daily),
      m.cooling_seconds === null ? "" : String(m.cooling_seconds),
      // Escaped exactly as `canonicalMandate` in the engine escapes it. The
      // seed joined raw until 2026-09-12, which agreed only because no key
      // here holds a character that changes under it.
      [...m.co_signers].sort().map(encodeURIComponent).join(","),
      String(m.lapses_at),
      String(m.version),
    ].join("\n"),
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
  maker: "made-by-tea",
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
