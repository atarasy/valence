import { records, type Records } from './records.ts';
import { createHash, randomUUID } from 'node:crypto';
import type { openMemberAuthority } from './authority.ts';
import type { openMandateBindings } from './mandate-binding.ts';

type Authority = ReturnType<typeof openMemberAuthority>;
type Bindings = ReturnType<typeof openMandateBindings>;
export type StatementTerms = { offer: string; mandate: string; presenter: string; canonical: string; reviewedRevision: string; expiresAt: number };
type State = 'prepared' | 'dispatching' | 'uncertain' | 'committed' | 'cancelled' | 'refused';
export type JournalOperation = StatementTerms & { id: string; kind: 'physical_statement'; principal: string; credential: string; household: string; keyFingerprint: string; requestDigest: string; challenge: string; createdAt: number; state: State; assertionFingerprint: string | null; receiptDigest: string | null; refusal: string | null };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function identifier(value: string) { if (typeof value !== 'string' || !value.length || value.length > 512 || /[\u0000-\u001f]/.test(value)) throw new Error('Invalid operation input'); }
function digest(value: string) { if (!/^[a-f0-9]{64}$/.test(value)) throw new Error('Invalid operation digest'); }
function timestamp(value: number) { if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid operation time'); }
/** Internal journal only: callers must validate server terms and assertions before claiming. */
export function openOperationJournal(path: Records, authority: Authority, bindings: Bindings, policy: { maximumLifetimeMs: number; now?: () => number }) {
  if (authority.scope.environment !== bindings.scope.environment || authority.scope.audience !== bindings.scope.audience) throw new Error('Operation binding scope mismatch');
  timestamp(policy.maximumLifetimeMs); if (!policy.maximumLifetimeMs) throw new Error('Positive operation lifetime required');
  const now = () => { const value = (policy.now ?? Date.now)(); timestamp(value); return value; };
  const scope = JSON.stringify([1, authority.scope.environment, authority.scope.audience]);
  path.assert(authority,bindings);const db=path,operations=records<JournalOperation>(path,'member_operations');
  function requestHash(value: Pick<JournalOperation, 'principal' | 'credential' | 'household' | 'keyFingerprint' | 'offer' | 'mandate' | 'presenter' | 'canonical' | 'reviewedRevision' | 'expiresAt'>) {
    return hash(JSON.stringify(['atarasy.member-operation.1', scope, value.principal, value.credential, value.household, value.keyFingerprint, value.offer, value.mandate, value.presenter, value.canonical, value.reviewedRevision, value.expiresAt]));
  }
  function get(id: string): JournalOperation {
    identifier(id);
    const operation=operations.get(id);if(!operation||operation.id!==id)throw new Error('Operation unavailable');
    const keys = 'assertionFingerprint canonical challenge createdAt credential expiresAt household id keyFingerprint kind mandate offer presenter principal receiptDigest refusal requestDigest reviewedRevision state'.split(' ').sort().join(',');
    if (Object.keys(operation).sort().join(',') !== keys || operation.kind !== 'physical_statement' ||
        operation.requestDigest !== requestHash(operation) || operation.challenge !== createHash('sha256').update(operation.canonical).digest('base64url')) throw new Error('Inconsistent operation storage');
    timestamp(operation.createdAt); timestamp(operation.expiresAt);
    if (operation.expiresAt <= operation.createdAt) throw new Error('Inconsistent operation storage');
    if (['dispatching','uncertain','committed'].includes(operation.state)) { if (operation.assertionFingerprint === null) throw new Error('Inconsistent operation storage'); digest(operation.assertionFingerprint); }
    else if (operation.assertionFingerprint !== null) throw new Error('Inconsistent operation storage');
    if (operation.state === 'committed') { if (operation.receiptDigest === null) throw new Error('Inconsistent operation storage'); digest(operation.receiptDigest); }
    else if (operation.receiptDigest !== null) throw new Error('Inconsistent operation storage');
    if (operation.state === 'refused') { if (!['review_changed','authority_changed','expired'].includes(operation.refusal ?? '')) throw new Error('Inconsistent operation storage'); }
    else if (operation.refusal !== null) throw new Error('Inconsistent operation storage');
    return operation;
  }
  function save(operation: JournalOperation) { operations.put(operation.id,operation); }
  function bound(token: string, terms: Pick<StatementTerms, 'offer' | 'mandate' | 'presenter'>, operation?: JournalOperation) {
    const current = bindings.resolve(token, terms.mandate), b = current.binding;
    const owner = authority.transactionOfferOwner(terms.offer);
    if (!owner || owner.household !== b.household || owner.presenter !== terms.presenter || !current.presenters.includes(terms.presenter)) throw new Error('Operation unavailable');
    if (operation && (operation.principal !== b.principal || operation.credential !== b.credential || operation.household !== b.household || operation.keyFingerprint !== b.fingerprint)) throw new Error('Operation unavailable');
    return current;
  }
  function owned(token: string, id: string) {
    const operation = get(id); bound(token, operation, operation); return operation;
  }
  return path.register({
    findBlocking(predicate:(v:JournalOperation)=>boolean){return operations.find(predicate);},
    async prepare(token: string, input: StatementTerms) {
      const terms = structuredClone(input);
      if (Object.keys(terms).sort().join(',') !== 'canonical,expiresAt,mandate,offer,presenter,reviewedRevision') throw new Error('Invalid operation input');
      for (const value of [terms.offer, terms.mandate, terms.presenter]) identifier(value);
      digest(terms.reviewedRevision); timestamp(terms.expiresAt);
      if (typeof terms.canonical !== 'string' || Buffer.byteLength(terms.canonical) > 65536 || !terms.canonical.startsWith('valence.statement.1\n' + terms.offer + '\n')) throw new Error('Invalid canonical statement');
      return db.transaction(() => {
        const evidence = bound(token, terms), at = now();
        const requestDigest = requestHash({ ...terms, principal: evidence.binding.principal, credential: evidence.binding.credential, household: evidence.binding.household, keyFingerprint: evidence.binding.fingerprint });
        const existing = operations.find(v=>v.offer===terms.offer&&['prepared','dispatching','uncertain','committed'].includes(v.state)) as { id: string } | null;
        if (existing) {
          const operation = get(existing.id); bound(token, operation, operation);
          if (operation.requestDigest !== requestDigest) throw new Error('Offer has another operation');
          return operation;
        }
        if (terms.expiresAt <= at || terms.expiresAt - at > policy.maximumLifetimeMs || terms.expiresAt > evidence.expiresAt) throw new Error('Operation expiry unavailable');
        const b = evidence.binding;
        const operation: JournalOperation = { ...terms, id: randomUUID(), kind: 'physical_statement', principal: b.principal, credential: b.credential, household: b.household, keyFingerprint: b.fingerprint, requestDigest, challenge: createHash('sha256').update(terms.canonical).digest('base64url'), createdAt: at, state: 'prepared', assertionFingerprint: null, receiptDigest: null, refusal: null };
        operations.insert(operation.id,operation);
        return operation;
      }).immediate();
    },
    async read(token: string, id: string) { return owned(token, id); },
    /** The trusted adapter must verify the actual assertion and current review first. */
    async claimVerified(token: string, id: string, proof: { requestDigest: string; assertionFingerprint: string; reviewedRevision: string }) {
      const fixed = structuredClone(proof);
      if (Object.keys(fixed).sort().join(',') !== 'assertionFingerprint,requestDigest,reviewedRevision') throw new Error('Invalid operation proof');
      for (const value of [fixed.requestDigest, fixed.assertionFingerprint, fixed.reviewedRevision]) digest(value);
      return db.transaction(() => {
        const operation = get(id); bound(token, operation, operation);
        if (operation.requestDigest !== fixed.requestDigest || operation.reviewedRevision !== fixed.reviewedRevision) throw new Error('Operation content changed');
        if (operation.state !== 'prepared') {
          if (['dispatching','uncertain','committed'].includes(operation.state) && operation.assertionFingerprint === fixed.assertionFingerprint) return { acquired: false, operation };
          throw new Error('Operation cannot be claimed');
        }
        if (operation.expiresAt <= now()) throw new Error('Operation expired');
        operation.state = 'dispatching'; operation.assertionFingerprint = fixed.assertionFingerprint;
        save(operation); return { acquired: true, operation };
      }).immediate();
    },
    async cancel(token: string, id: string) {
      return db.transaction(() => {
        const operation = get(id); bound(token, operation, operation);
        if (operation.state === 'cancelled') return operation;
        if (operation.state !== 'prepared') throw new Error('Dispatch may have started');
        operation.state = 'cancelled'; save(operation); return operation;
      }).immediate();
    },
    /** Internal recovery calls have no member route; no call here executes an effect. */
    markUncertain(id: string) {
      return db.transaction(() => {
        const operation = get(id);
        if (operation.state === 'uncertain') return operation;
        if (operation.state !== 'dispatching') throw new Error('No uncertain dispatch');
        operation.state = 'uncertain'; save(operation); return operation;
      }).immediate();
    },
    recordCommitted(id: string, assertionFingerprint: string, receiptDigest: string) {
      digest(assertionFingerprint); digest(receiptDigest);
      return db.transaction(() => {
        const operation = get(id);
        if (operation.assertionFingerprint !== assertionFingerprint) throw new Error('Different operation confirmation');
        if (operation.state === 'committed' && operation.receiptDigest === receiptDigest) return operation;
        if (!['dispatching','uncertain'].includes(operation.state)) throw new Error('Operation outcome conflict');
        operation.state = 'committed'; operation.receiptDigest = receiptDigest; save(operation); return operation;
      }).immediate();
    },
    refuseBeforeDispatch(id: string, reason: 'review_changed' | 'authority_changed' | 'expired') {
      if (!['review_changed','authority_changed','expired'].includes(reason)) throw new Error('Invalid refusal');
      return db.transaction(() => {
        const operation = get(id);
        if (operation.state !== 'prepared') throw new Error('Dispatch may have started');
        operation.state = 'refused'; operation.refusal = reason; save(operation); return operation;
      }).immediate();
    },
    close() { db.close(); },
  });
}
