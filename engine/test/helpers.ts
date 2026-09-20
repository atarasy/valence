import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { ValenceEngine, canonicalConfig } from "../src/engine/offers.js";
import type { Store } from "../src/common/store.js";
import { InMemoryLedger } from "../src/engine/ledger.js";
import { canonical, type EdgeInput } from "../src/shared/lineage.js";
import { canonicalDecisions, type DecisionInput } from "../src/shared/decisions.js";
import { canonicalDisclosure } from "../src/shared/disclosure.js";
import { canonicalStatement, statementLines } from "../src/shared/statement.js";
import { canonicalWithdrawal } from "../src/shared/decisions.js";
import { canonicalGift } from "../src/shared/gift.js";
import { DeliveryRegister } from "../src/hub/delivery.js";
import { LocalDeliveries } from "../src/engine/delivery-source.js";
import { nameOf } from "../src/common/names.js";

/** Clause 35. The key the unit tests confirm with, and the household it names (§13.2). */
export const MANDATE_PAIR = generateKeyPairSync("ed25519");

/**
 * §13.2, question 55. A household's identifier is the name of its key and a
 * mandate's is that identifier with a label, so the fixture derives both
 * rather than choosing them. A test that wants a household it cannot sign for
 * takes one from `otherHousehold`.
 */
export const HOUSEHOLD = nameOf(MANDATE_PAIR.publicKey.export({ type: "spki", format: "pem" }).toString());
export const MANDATE = `${HOUSEHOLD}.1`;

/**
 * A household named after a key derived from a label, so a fixture that used
 * to choose a readable name keeps one thing that reads and gains an identifier
 * of the shape §13.2 requires. Deterministic, so a diff of these files is
 * about what changed rather than about which keys were generated.
 */
const ED25519_PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex");
export function houseFor(label: string) {
  const seed = createHash("sha256").update(`valence-fixture/${label}`).digest();
  const privateKey = createPrivateKey({ key: Buffer.concat([ED25519_PKCS8, seed]), format: "der", type: "pkcs8" });
  const pem = createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
  const household = nameOf(pem);
  return {
    household,
    mandate: `${household}.1`,
    pem,
    privateKey,
    sign: (bytes: Buffer) => sign(null, bytes, privateKey).toString("base64"),
    signEdge: (edge: EdgeInput) => sign(null, canonical(edge), privateKey).toString("base64"),
  };
}

/** A household this fixture holds no private key for. */
export function otherHousehold(label = "1"): { household: string; mandate: string } {
  const { publicKey } = generateKeyPairSync("ed25519");
  const household = nameOf(publicKey.export({ type: "spki", format: "pem" }).toString());
  return { household, mandate: `${household}.${label}` };
}

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
  const lines = statementLines(offer, disputed, engine.recoveries.for(offerId)?.missing ?? []);
  // §6.5, question 40. The carriage is inside the bytes, and the helper reads
  // it where the screen does rather than being told it, so a test that records
  // a different figure signs the figure it recorded.
  const carried = await engine.deliveryFor(offerId);
  const signature = sign(null, canonicalStatement(offerId, carried ? carried.carriage : 0, lines), MANDATE_PAIR.privateKey).toString("base64");
  return await engine.settle(offerId, now, { signed: { signature }, disputed });
}

/**
 * §16.5, decided 2026-09-20. Take a signed set back, signed. The route asked
 * for nothing until the third refutation pass over question 68 measured a
 * caller holding nothing but an offer id voiding a recipient's written
 * refusal of a gift, after which §12's expiry charged the giver.
 */
export async function withdrawSigned(
  engine: ValenceEngine,
  offerId: string,
  now = Date.now(),
  key = MANDATE_PAIR.privateKey
) {
  const offer = engine.mustGet(offerId, now);
  const bytes = canonicalWithdrawal(offerId, offer.decided_at ?? 0);
  return await engine.withdrawDecisions(offerId, { signature: sign(null, bytes, key).toString("base64") }, now);
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
  isInNetwork: (merchant: string) => boolean;
}> = {}, store?: Store) {
  // A store may be passed so that a test can reopen what an engine wrote, or
  // make one of its writes fail (question 66's write order).
  const ledger = new InMemoryLedger(store);
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
  }, store);
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
  engine.registerIdentity(HOUSEHOLD, MANDATE_PAIR.publicKey.export({ type: "spki", format: "pem" }).toString());
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

/**
 * §12, question 64. A gift is presented on its giver's signature, so a fixture
 * that presents one registers the giver's key and signs the terms the engine
 * reads, as a giver's device would after recomputing them.
 */
export const GIFT_GIVER = houseFor("gift-giver");
export async function presentGift(
  engine: ValenceEngine,
  offerId: string,
  now = Date.now(),
  giver: ReturnType<typeof houseFor> = GIFT_GIVER
) {
  try { engine.registerIdentity(giver.household, giver.pem); } catch { /* already held */ }
  return engine.present(offerId, now, { signature: giver.sign(canonicalGift(engine.giftTerms(offerId))) });
}
