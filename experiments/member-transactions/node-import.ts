import type { ValenceEngine } from '../../engine/src/engine/offers.ts';
import { verifyDisclosure } from '../../engine/src/shared/disclosure.ts';
import { verifyEdge } from '../../engine/src/shared/lineage.ts';
import type { NodeExport } from '../../engine/src/hub/node.ts';
import { EXPORT_FORMAT_VERSION } from '../../engine/src/hub/node.ts';

type Check = (v: unknown) => void;
const fail = (): never => { throw new Error('Invalid node archive'); };
const text: Check = v => { if (typeof v !== 'string' || v.length > 65536) fail(); };
const id: Check = v => { if (typeof v !== 'string' || !v || v.length > 512 || /[\u0000-\u001f\u007f]/.test(v)) fail(); };
const integer: Check = v => { if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) fail(); };
const bool: Check = v => { if (typeof v !== 'boolean') fail(); };
const one = (...values: unknown[]): Check => v => { if (!values.includes(v)) fail(); };
const nullable = (check: Check): Check => v => { if (v !== null) check(v); };
const array = (check: Check): Check => v => { if (!Array.isArray(v) || v.length > 10000) fail(); for (const x of v as unknown[]) check(x); };
const object = (shape: Record<string, Check>): Check => v => {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).sort().join(',') !== Object.keys(shape).sort().join(',')) fail();
  for (const [k, check] of Object.entries(shape)) check((v as Record<string, unknown>)[k]);
};
const unique = <T>(rows: T[], key: (row: T) => string) => { const keys = rows.map(key); if (new Set(keys).size !== keys.length) fail(); };
const valence = one('offered', 'kept', 'returned', 'consumed', 'defaulted', 'lost');
const disclosure = object({ merchant: id, product: nullable(id), version: id, signature: text, items: array(object({ label: text, value: text })) });
const candidate = object({ id, product: id, quantity: integer, unit_price: integer, merchant: id, maker: id, ships: id, category: nullable(id), predicted_conversion: nullable(v => { if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) fail(); }), is_exploration: bool, given_by: nullable(id), valence, decided_at: nullable(integer), kept_as: nullable(one('self', 'gift', 'order')), lineage: nullable(id) });
const offer = object({ id, binding: one('physical', 'digital'), household: id, presenter: id, presenter_attested: bool, purpose: one('gift', 'replenish', 'trial', 'ceremonial', 'assortment'), price_band: nullable(object({ min: integer, max: integer })), giver: nullable(id), config_version: id, presented_at: nullable(integer), expires_at: integer, state: one('drafted', 'presented', 'decided', 'expired', 'withdrawn', 'settled'), exploration_floor_met: bool, mandate: id, candidates: array(candidate), disclosures: array(disclosure), reminders_sent: one(0, 1), decided_at: nullable(integer) });
const settlement = object({ offer: id, settled_at: integer, kept_amount: integer, consumed_amount: integer, lost_amount: integer, charged: integer, disputed_amount: integer, lines: array(object({ candidate: id, product: id, merchant: id, maker: id, ships: id, valence, amount: integer, disputed: bool })), payer: id, signed_by: id, signed_as: one('agent'), receipt: id, confirmation: nullable(text) });
// Question 68: preserve the decision-time record without admitting arbitrary
// fields into an archive. The ceiling and stale markers are optional on it.
const protection: Check = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(k => !['at', 'cooling_seconds', 'ceiling_daily', 'stale'].includes(k))) fail();
  integer(v.at); nullable(integer)(v.cooling_seconds);
  if ('ceiling_daily' in v) nullable(integer)(v.ceiling_daily);
  if ('stale' in v) { array(one('cooling_seconds', 'ceiling_daily'))(v.stale); unique(v.stale as string[], x => x); }
};
const protectionRecords: Check = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  for (const [key, record] of Object.entries(value)) { id(key); protection(record); }
};
const schema = object({ format: one(EXPORT_FORMAT_VERSION, 'valence-node/7', 'valence-node/6', 'valence-node/5', 'valence-node/4'), decided_protections: protectionRecords, household: id, exported_at: integer, offers: array(offer), settlements: array(settlement), notes: array(object({ candidate: id, author: id, text, shared_with: array(one('recipient', 'merchant')), created_at: integer })), lineage: array(object({ id, from: id, to: id, product: id, merchant: id, maker: id, kind: one('gift', 'return', 'regift', 'thanks'), occasion: text, receipt: id, signature: text, attested: bool, created_at: integer })), receipts: array(object({ ref: id, at: integer })), payments: array(object({ offer: id, presenter: id, settled_at: integer, charged: integer, receipt: id })), gifts_in_flight: array(id), recoveries: array(object({ id, household: id, initiated_by: id, at: integer, notified: array(object({ channel: id, controlled_by_recoverer: bool })) })), collections: array(object({ offer: id, due_at: integer, grace_days: integer, collected_at: nullable(integer), returned: array(id), consumed: array(id), missing: array(id), missing_notes: v => { if (!v || typeof v !== 'object' || Array.isArray(v)) fail(); for (const note of Object.values(v as Record<string, unknown>)) { if (typeof note !== 'string' || !note.trim() || note.length > 500) fail(); } } })), permissions: array(object({ id, kind: one('party', 'computation'), result_form: nullable(one('aggregate')), grantee: id, scope: array(id), purpose: text, granted_at: integer, expires_at: integer, asked_from: id, revoked_at: nullable(integer) })), queries: array(object({ id, asked_by: id, product: id, answered: bool, at: integer })), mandates: array(object({ id, household: id, ceiling_out_of_network: integer, co_signers: array(id), ceiling_daily: nullable(integer), cooling_seconds: nullable(integer), lapses_at: integer, version: integer })), deliveries: array(object({ offer: id, carriage: integer, code: text, status: one('placed', 'in_transit', 'delivered', 'returned'), updated_at: integer })), confirmations: v => { if (!v || typeof v !== 'object' || Array.isArray(v)) fail(); for (const [k, values] of Object.entries(v!)) { id(k); array(id)(values); unique(values as string[], x => x); } } });
/** Exact current archive format; does not authenticate the source or authorise a live move. */
export function validateNodeImport(input: unknown, household: string): NodeExport {
  id(household); const encoded = JSON.stringify(input, (_key, value) => { if (typeof value === 'number' && !Number.isFinite(value)) fail(); if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') fail(); return value; }); if (!encoded || Buffer.byteLength(encoded) > 4 * 1024 * 1024) fail();
  const node = JSON.parse(encoded) as NodeExport;
  // Older versions could not carry this record. Current exports must name it.
  if (node && ['valence-node/4', 'valence-node/5', 'valence-node/6', 'valence-node/7'].includes(node.format) && !Object.hasOwn(node, 'decided_protections')) node.decided_protections = {};
  schema(node); if (node.household !== household) fail();
  for (const rows of [node.offers, node.lineage, node.recoveries, node.permissions, node.queries, node.mandates]) unique(rows as { id: string }[], x => x.id);
  for (const rows of [node.settlements, node.collections, node.deliveries]) unique(rows as { offer: string }[], x => x.offer);
  unique(node.receipts, x => x.ref); unique(node.payments, x => x.offer); unique(node.gifts_in_flight, x => x); unique(node.notes, x => JSON.stringify([x.candidate, x.author]));
  const offers = new Map(node.offers.map(o => [o.id, o])), candidates = new Map<string, NodeExport['offers'][number]['candidates'][number]>(), mandates = new Map(node.mandates.map(m => [m.id, m]));
  for (const m of node.mandates) { if (m.household !== household || m.version < 1) fail(); unique(m.co_signers, x => x); }
  for (const o of node.offers) {
    if (o.household !== household || !mandates.has(o.mandate) || !o.candidates.length || (o.price_band && o.price_band.min > o.price_band.max)) fail();
    for (const c of o.candidates) { if (candidates.has(c.id) || c.quantity < 1 || !Number.isSafeInteger(c.quantity * c.unit_price)) fail(); candidates.set(c.id, c); }
    unique(o.disclosures, d => JSON.stringify([d.merchant, d.product]));
    if (o.candidates.some(c => !o.disclosures.some(d => d.merchant === c.merchant && d.product === null))) fail();
    if ((o.state === 'settled') !== node.settlements.some(s => s.offer === o.id)) fail();
    const collection = node.collections.find(r => r.offer === o.id);
    if (o.binding === 'physical' && o.state !== 'drafted' && !collection) fail();
    for (const c of o.candidates) { if (c.lineage !== null && !node.lineage.some(e => e.id === c.lineage)) fail(); if (c.valence === 'consumed' && !collection?.consumed.includes(c.id)) fail(); }
  }
  for (const n of node.notes) { if (!candidates.has(n.candidate)) fail(); unique(n.shared_with, x => x); }
  for (const key of Object.keys(node.decided_protections)) if (!offers.has(key)) fail();
  for (const key of Object.keys(node.confirmations)) if (!offers.has(key)) fail();
  for (const e of node.lineage) if (e.from !== household && e.to !== household) fail();
  for (const r of node.recoveries) if (r.household !== household) fail();
  for (const d of node.deliveries) if (offers.get(d.offer)?.binding !== 'physical') fail();
  for (const r of node.collections) {
    const o = offers.get(r.offer); if (!o || o.binding !== 'physical') fail();
    unique([...r.returned, ...r.consumed, ...r.missing], x => x);
    // Question 46: a missing item became lost and carries exactly one note.
    for (const [ids, state] of [[r.returned, 'returned'], [r.consumed, 'consumed'], [r.missing, 'lost']] as const) for (const key of ids) if (!o!.candidates.some(c => c.id === key && c.valence === state)) fail();
    if (Object.keys(r.missing_notes).sort().join(',') !== [...r.missing].sort().join(',')) fail();
    if (r.collected_at === null && (r.returned.length || r.consumed.length || r.missing.length)) fail();
  }
  for (const p of node.permissions) { if (p.grantee === household || !p.scope.length || p.expires_at <= p.granted_at || (p.kind === 'computation') !== (p.result_form === 'aggregate')) fail(); unique(p.scope, x => x); }
  for (const s of node.settlements) {
    const o = offers.get(s.offer); if (!o || s.signed_by !== o.presenter || s.payer !== (o.giver ?? household) || s.charged !== s.kept_amount + s.consumed_amount) fail();
    const missing = node.collections.find(r => r.offer === s.offer)?.missing ?? [];
    if (o!.binding === 'physical' && o!.candidates.some(c => c.valence === 'consumed' || (c.valence === 'lost' && missing.includes(c.id))) && !s.confirmation) fail();
    unique(s.lines, l => l.candidate);
    const expected = o!.candidates.filter(c => ['kept', 'defaulted', 'consumed', 'lost'].includes(c.valence));
    if (expected.length !== s.lines.length) fail();
    let kept = 0, consumed = 0, lost = 0, disputed = 0;
    for (const l of s.lines) { const c = expected.find(c => c.id === l.candidate); if (!c || ['product', 'merchant', 'maker', 'ships', 'valence'].some(k => c[k as keyof typeof c] !== l[k as keyof typeof l]) || l.amount !== (c.valence === 'lost' ? c.quantity * c.unit_price : c.given_by ? 0 : c.quantity * c.unit_price) || (l.disputed && !(l.valence === 'consumed' || (l.valence === 'lost' && missing.includes(l.candidate))))) fail(); if (l.valence === 'lost') lost += l.amount; else if (l.disputed) disputed += l.amount; else if (l.valence === 'consumed') consumed += l.amount; else kept += l.amount; }
    if (kept !== s.kept_amount || consumed !== s.consumed_amount || lost !== s.lost_amount || disputed !== s.disputed_amount) fail();
  }
  return node;
}
/** Dependency checks use already trusted destination keys/catalogues, not keys supplied in the archive. */
export function validateArchiveDependencies(node: NodeExport, engine: ValenceEngine): void {
  for (const o of node.offers) {
    const config = engine.configsForPresenter(o.presenter).find(c => c.version === o.config_version);
    if (!config || o.candidates.some(c => { const p = config.products[c.product]; return !p || p.price !== c.unit_price || p.merchant !== c.merchant || p.maker !== c.maker || p.ships !== c.ships; })) fail();
    for (const d of o.disclosures) { const key = engine.publicKeyFor(d.merchant); if (!key || !verifyDisclosure(d, key)) fail(); }
  }
  for (const e of node.lineage) { const key = engine.publicKeyFor(e.from); if (!key || !verifyEdge(e, key)) fail(); }
}
