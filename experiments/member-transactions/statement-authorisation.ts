import { createHash } from 'node:crypto';
import { ValenceEngine } from '../../engine/src/engine/offers.ts';
import { InMemoryLedger } from '../../engine/src/engine/ledger.ts';
import { DeliveryRegister } from '../../engine/src/hub/delivery.ts';
import { LocalDeliveries } from '../../engine/src/engine/delivery-source.ts';
import { renderStatement } from '../../engine/src/hub/statement.ts';
import { canonicalStatement, statementLines, needsStatement } from '../../engine/src/shared/statement.ts';
import { verifyDisclosure } from '../../engine/src/shared/disclosure.ts';
import { openMemberAuthority } from '../member-read/authority.ts';
import { openVerifiedLogin, type PreparedAssertion } from '../member-login/login.ts';
import { openAtomicStore } from './atomic-store.ts';
import { openMandateBindings } from './mandate-binding.ts';
import { openOperationJournal, type JournalOperation } from './operation-journal.ts';
import { databaseFor } from './shared-database.ts';

export const AUTHORISATION_PROFILE = 'atarasy.member-statement-authorisation.1';
function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  return '{' + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => JSON.stringify(k) + ':' + stable(v)).join(',') + '}';
}
const hash = (value: unknown) => createHash('sha256').update(stable(value)).digest('hex');
function identifier(value: unknown): asserts value is string { if (typeof value !== 'string' || !value || value.length > 512 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Invalid statement input'); }
function integer(value: number) { if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid statement amount or time'); }
type Policy = { environment: string; origin: string; rpID: string; maximumLifetimeMs: number; maxSessionLifetimeMs: number; now?: () => number; engine: ConstructorParameters<typeof ValenceEngine>[1] };
/** Internal authorisation only. Its contextual challenge is NOT an engine settlement signature. */
export function openStatementAuthorisations(path: string, options: Policy) {
  const policy = { ...options, engine: { ...options.engine } };
  if (policy.rpID !== policy.engine.relyingPartyId || new URL(policy.origin).origin !== policy.origin || new URL(policy.origin).hostname !== policy.rpID || !policy.origin.startsWith('https://')) throw new Error('Statement scope mismatch');
  integer(policy.maximumLifetimeMs); if (!policy.maximumLifetimeMs) throw new Error('Positive lifetime required');
  const scope = { environment: policy.environment, audience: policy.origin }, unit = openAtomicStore(path, scope);
  const clock = () => { const at = (policy.now ?? Date.now)(); integer(at); return at; };
  const reviewScope = stable([1, policy.environment, policy.origin, policy.rpID]);
  function challenge(operation: JournalOperation) {
    return createHash('sha256').update(stable([AUTHORISATION_PROFILE, reviewScope, operation.id, operation.requestDigest, operation.reviewedRevision])).digest('base64url');
  }
  function run<T>(work: (r: ReturnType<typeof runtime>) => Promise<T> | T) {
    return unit.run((store, database) => work(runtime(store, database)));
  }
  function runtime(store: Parameters<Parameters<typeof unit.run>[0]>[0], database: Parameters<Parameters<typeof unit.run>[0]>[1]) {
    const engine = new ValenceEngine(new InMemoryLedger(store), policy.engine, store), deliveries = new DeliveryRegister(store);
    engine.readDeliveriesFrom(new LocalDeliveries(deliveries));
    const authority = openMemberAuthority(database, { ...scope, maxSessionLifetimeMs: policy.maxSessionLifetimeMs, now: clock });
    const login = openVerifiedLogin(database, authority, { environment: policy.environment, origin: policy.origin, rpID: policy.rpID, challengeLifetimeMs: policy.maximumLifetimeMs, sessionLifetimeMs: policy.maxSessionLifetimeMs, now: clock });
    const bindings = openMandateBindings(database, authority, login, engine);
    const journal = openOperationJournal(database, authority, bindings, { maximumLifetimeMs: policy.maximumLifetimeMs, now: clock });
    const db = databaseFor(database, scope).db;
    const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('statement_review_meta','statement_reviews')").all() as { name: string }[];
    if (!tables.length) {
      db.run('CREATE TABLE statement_review_meta(scope TEXT NOT NULL); CREATE TABLE statement_reviews(operation TEXT PRIMARY KEY REFERENCES operations(id), record TEXT NOT NULL);');
      db.query('INSERT INTO statement_review_meta VALUES (?)').run(reviewScope);
    } else {
      const rows = db.query('SELECT scope FROM statement_review_meta').all() as { scope: string }[];
      if (tables.length !== 2 || rows.length !== 1 || rows[0]!.scope !== reviewScope) throw new Error('Statement review scope mismatch');
    }
    function snapshot(token: string, offerID: string, disputed: string[]) {
      const offer = engine.mustGet(offerID, clock());
      const bound = bindings.resolve(token, offer.mandate);
      const owner = authority.transactionOfferOwner(offerID);
      if (!owner || owner.household !== bound.binding.household || offer.household !== owner.household || owner.presenter !== offer.presenter || !bound.presenters.includes(offer.presenter)) throw new Error('Statement unavailable');
      if (!needsStatement(offer) || !['decided', 'expired'].includes(offer.state) || engine.settlement(offerID)) throw new Error('Statement unavailable');
      const delivery = deliveries.find(offerID); if (!delivery) throw new Error('Delivery unavailable'); integer(delivery.carriage);
      const mandate = engine.mandates.mustGet(offer.mandate, clock()); if (mandate.household !== offer.household) throw new Error('Mandate unavailable');
      const catalogue = engine.configsForPresenter(offer.presenter).find(c => c.version === offer.config_version); if (!catalogue) throw new Error('Catalogue unavailable');
      if (!Array.isArray(disputed) || disputed.length > 1000 || new Set(disputed).size !== disputed.length) throw new Error('Invalid disputes');
      disputed.forEach(identifier);
      for (const id of disputed) if (!offer.candidates.some(c => c.id === id && c.valence === 'consumed')) throw new Error('Invalid disputes');
      for (const c of offer.candidates) {
        integer(c.unit_price); integer(c.quantity); integer(c.unit_price * c.quantity); if (!c.quantity) throw new Error('Invalid quantity');
        const entry = catalogue.products[c.product];
        if (!entry || entry.price !== c.unit_price || entry.merchant !== c.merchant || entry.maker !== c.maker || entry.ships !== c.ships) throw new Error('Catalogue changed');
        if (!offer.disclosures.some(d => d.merchant === c.merchant && d.product === null)) throw new Error('Disclosure missing');
      }
      for (const d of offer.disclosures) { const key = engine.publicKeyFor(d.merchant); if (!key || !verifyDisclosure(d, key)) throw new Error('Disclosure invalid'); }
      const lines = statementLines(offer, disputed); integer(lines.reduce((sum, line) => sum + line.amount, 0));
      const canonical = canonicalStatement(offerID, delivery.carriage, lines).toString();
      const { challenge: _legacy, ...statement } = renderStatement(offer, delivery);
      const view = { statement, disputed: [...disputed].sort(), mandate: structuredClone(mandate) };
      const sealed = { offer: structuredClone(offer), catalogue, delivery, mandate: structuredClone(mandate), recovery: engine.recoveries.for(offerID) ?? null, view };
      if (Buffer.byteLength(stable(sealed)) > 262144) throw new Error('Statement snapshot too large');
      const revision = hash(sealed);
      return { canonical, revision, view, sealed, bound };
    }
    type Review = { sealed: ReturnType<typeof snapshot>['sealed']; revision: string; canonical: string; challenge: string; verified: null | { fingerprint: string; counter: number; at: number } };
    function saved(operation: JournalOperation): Review {
      const row = db.query('SELECT record FROM statement_reviews WHERE operation=?').get(operation.id) as { record: string } | null;
      if (!row) throw new Error('Prepared statement unavailable');
      const value = JSON.parse(row.record) as Review;
      if (hash(value.sealed) !== operation.reviewedRevision || value.revision !== operation.reviewedRevision || value.canonical !== operation.canonical || value.challenge !== challenge(operation)) throw new Error('Prepared statement inconsistent');
      if (Object.keys(value).sort().join(',') !== 'canonical,challenge,revision,sealed,verified') throw new Error('Prepared statement inconsistent');
      if (value.verified !== null) {
        const proof = value.verified;
        if (Object.keys(proof).sort().join(',') !== 'at,counter,fingerprint' || !/^[a-f0-9]{64}$/.test(proof.fingerprint)) throw new Error('Prepared statement inconsistent');
        integer(proof.at); integer(proof.counter);
        if (proof.counter > 0xffffffff || proof.at < operation.createdAt || proof.at >= operation.expiresAt) throw new Error('Prepared statement inconsistent');
      }
      return value;
    }
    function response(operation: JournalOperation, review: Review) {
      return { profile: AUTHORISATION_PROFILE, operationID: operation.id, requestDigest: operation.requestDigest, reviewedRevision: operation.reviewedRevision, expiresAt: operation.expiresAt, canonical: review.canonical, review: review.sealed.view, operationState: operation.state, publicKey: { challenge: review.challenge, rpId: policy.rpID, userVerification: 'required' as const, allowCredentials: [{ type: 'public-key' as const, id: operation.credential }] }, authorisation: review.verified ? 'verified' as const : 'prepared' as const };
    }
    return { engine, authority, login, bindings, journal, db, snapshot, saved, response };
  }
  return {
    prepare(token: string, input: { offer: string; disputed: string[] }) {
      const fixed = structuredClone(input);
      if (!fixed || Object.keys(fixed).sort().join(',') !== 'disputed,offer') throw new Error('Invalid statement input'); identifier(fixed.offer);
      return run(async r => {
        const fresh = r.snapshot(token, fixed.offer, fixed.disputed);
        const previous = r.db.query("SELECT id FROM operations WHERE offer=? AND state IN ('prepared','dispatching','uncertain','committed')").get(fixed.offer) as { id: string } | null;
        if (previous) {
          const operation = await r.journal.read(token, previous.id), review = r.saved(operation);
          if (operation.state !== 'prepared' || fresh.revision !== review.revision || fresh.canonical !== review.canonical) throw new Error('Review changed');
          return r.response(operation, review);
        }
        const expiresAt = Math.min(clock() + policy.maximumLifetimeMs, fresh.bound.expiresAt, fresh.view.mandate.lapses_at);
        const operation = await r.journal.prepare(token, { offer: fixed.offer, mandate: fresh.bound.binding.mandate, presenter: fresh.sealed.offer.presenter, canonical: fresh.canonical, reviewedRevision: fresh.revision, expiresAt });
        const review = { sealed: fresh.sealed, revision: fresh.revision, canonical: fresh.canonical, challenge: challenge(operation), verified: null };
        r.db.query('INSERT INTO statement_reviews VALUES (?,?)').run(operation.id, JSON.stringify(review));
        return r.response(operation, review);
      });
    },
    read(token: string, id: string) { identifier(id); return run(async r => { const operation = await r.journal.read(token, id); return r.response(operation, r.saved(operation)); }); },
    verify(token: string, id: string, assertion: PreparedAssertion) {
      identifier(id); const fixed = structuredClone(assertion);
      return run(async r => {
        const operation = await r.journal.read(token, id), review = r.saved(operation);
        if (operation.state !== 'prepared') throw new Error('Authorisation unavailable');
        const fingerprint = hash(fixed);
        if (operation.expiresAt <= clock()) throw new Error('Authorisation expired');
        const fresh = r.snapshot(token, operation.offer, review.sealed.view.disputed);
        if (fresh.revision !== review.revision || fresh.canonical !== operation.canonical) throw new Error('Review changed');
        if (review.verified) {
          if (review.verified.fingerprint !== fingerprint) throw new Error('Different authorisation');
          return r.response(operation, review);
        }
        const verified = await r.login.verifyPreparedAssertion(operation.credential, review.challenge, fixed);
        // The database lock excludes competing writers; time-based expiry still needs another check.
        r.bindings.resolve(token, operation.mandate);
        if (operation.expiresAt <= clock()) throw new Error('Authorisation expired');
        review.verified = { fingerprint, counter: verified.counter, at: clock() };
        r.db.query('UPDATE statement_reviews SET record=? WHERE operation=?').run(JSON.stringify(review), operation.id);
        return r.response(operation, review);
      });
    },
    cancel(token: string, id: string) { identifier(id); return run(async r => { await r.journal.cancel(token, id); return { cancelled: true }; }); },
    close() { unit.close(); },
  };
}
