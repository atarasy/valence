// Fixture only: actual engine lifecycle and local ledger; fixture signatures, no provider.
import { sign } from 'node:crypto';
import type { Store } from '../../engine/src/common/store.ts';
import { ValenceEngine } from '../../engine/src/engine/offers.ts';
import { InMemoryLedger } from '../../engine/src/engine/ledger.ts';
import { DeliveryRegister } from '../../engine/src/hub/delivery.ts';
import { LocalDeliveries } from '../../engine/src/engine/delivery-source.ts';
import { canonicalStatement, statementLines } from '../../engine/src/shared/statement.ts';
import { MANDATE_PAIR, MERCHANT_PAIR, PRESENTER_PAIR, PHYSICAL, disclosureFor, signConfig } from '../../engine/test/helpers.ts';
import { nameOf } from '../../engine/src/common/names.ts';
import { openAtomicStore } from './atomic-store.ts';
import { canonicalMandate } from '../../engine/src/hub/mandates.ts';

// §13.2, question 55. A household's identifier is the name of its key and a
// mandate's is that identifier with a label, so the fixture derives both from
// the pair it signs with rather than naming a household `house`.
export const houseOf = (pair: { publicKey: { export: (o: unknown) => unknown } }) =>
  nameOf((pair.publicKey.export as (o: unknown) => Buffer | string)({ type: 'spki', format: 'pem' }).toString());
export const mandateOf = (pair: Parameters<typeof houseOf>[0]) => `${houseOf(pair)}.1`;
export const HOUSE = houseOf(MANDATE_PAIR);
export const FIXTURE_MANDATE = mandateOf(MANDATE_PAIR);
export const atomicScope = { environment: 'test', audience: 'https://unit.example' };
export const fixtureTime = 1_800_000_000_000;
export type FixtureStatement = { offer: string; signature: string; disputed: string[] };
export function localRuntime(store: Store) {
  const ledger = new InMemoryLedger(store), deliveries = new DeliveryRegister(store);
  const engine = new ValenceEngine(ledger, { explorationRate: 0.2, reminderLimit: 1, recoveryGraceDays: 3, relyingPartyId: 'unit.example' }, store);
  engine.readDeliveriesFrom(new LocalDeliveries(deliveries));
  return { engine, ledger, deliveries };
}
/**
 * Record a mandate the way §16.1 asks for it, with the household's own
 * signature over the canonical bytes. The pair is the household's, because
 * question 55 made the household the name of that key.
 */
export function recordFixtureMandate(
  engine: ValenceEngine,
  pair: typeof MANDATE_PAIR,
  terms: Omit<Parameters<typeof engine.mandates.record>[0]['mandate'], 'id' | 'household'>,
) {
  const mandate = { ...terms, id: mandateOf(pair), household: houseOf(pair) } as Parameters<typeof engine.mandates.record>[0]['mandate'];
  const bytes = canonicalMandate(mandate);
  const signatures: Record<string, string> = {
    [houseOf(pair)]: sign(pair.privateKey.asymmetricKeyType === 'ed25519' ? null : 'sha256', bytes, pair.privateKey).toString('base64'),
  };
  return engine.mandates.record({ mandate, signatures, assertions: {}, keyOf: (k: string) => engine.publicKeyFor(k), relyingPartyId: 'unit.example' });
}

export async function seedAtomicFixture(path: string, count = 1, ceiling: number | null = null, mandatePair = MANDATE_PAIR): Promise<FixtureStatement[]> {
  const unit = openAtomicStore(path, atomicScope);
  try { return await unit.run(async store => {
    const { engine, deliveries } = localRuntime(store);
    for (const [id, pair] of [['merchant-1', PRESENTER_PAIR], ['maker-a', MERCHANT_PAIR], [houseOf(mandatePair), mandatePair]] as const) engine.registerIdentity(id, pair.publicKey.export({ type: 'spki', format: 'pem' }).toString());
    const config = { version: 'atomic-cfg', presenter: 'merchant-1', products: Object.fromEntries(Array.from({ length: count }, (_, i) => ['tea-' + i, { merchant: 'maker-a', maker: 'made-by-tea', ships: 'carrier-a', price: 1200, physical: { ...PHYSICAL, keeps_for_days: 10000 } }])) };
    engine.registerConfig(config, signConfig(config)); engine.putDisclosure(disclosureFor('maker-a'));
    // §16.1, question 56. The fixture signs its own mandate rather than
    // importing one. An import writes a claim now, which no offer can name, and
    // a fixture that skipped the ceremony would be hiding the ceremony.
    recordFixtureMandate(engine, mandatePair, { ceiling_out_of_network: 10000, ceiling_daily: ceiling, cooling_seconds: null, co_signers: [], lapses_at: fixtureTime + 10000000, version: 1 });
    const offers = [];
    for (let i = 0; i < count; i++) {
      const offer = engine.createOffer({ binding: 'physical', household: houseOf(mandatePair), purpose: 'replenish', config_version: config.version, expires_at: fixtureTime + 3600000, mandate: mandateOf(mandatePair), price_band: null, giver: null, candidates: [{ product: 'tea-' + i, quantity: 1, predicted_conversion: 0.5, is_exploration: true, given_by: null }] });
      await engine.present(offer.id, fixtureTime); offers.push(offer);
    }
    return offers.map(offer => {
      deliveries.record({ offer: offer.id, carriage: 550, code: 'fixture-delivery', status: 'delivered', now: fixtureTime });
      engine.collect({ offer: offer.id, consumed: offer.candidates.map(c => c.id), returned: [], at: fixtureTime }); engine.applyRecoveryTo(offer.id, fixtureTime);
      const bytes = canonicalStatement(offer.id, 550, statementLines(offer, []));
      return { offer: offer.id, signature: sign(mandatePair.privateKey.asymmetricKeyType === 'ed25519' ? null : 'sha256', bytes, mandatePair.privateKey).toString('base64'), disputed: [] };
    });
  }); } finally { unit.close(); }
}
export async function settleFixture(store: Store, statement: FixtureStatement) {
  return localRuntime(store).engine.settle(statement.offer, fixtureTime + 1, { signed: { signature: statement.signature }, disputed: statement.disputed });
}
export function inspectFixture(store: Store, offer: string) {
  const { engine, ledger } = localRuntime(store);
  return { state: engine.mustGet(offer).state, reservation: ledger.get(offer), receipt: engine.settlement(offer) ?? null, day: engine.householdLedger.forHousehold(HOUSE) };
}
