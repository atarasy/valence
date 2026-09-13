import { afterEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connectJournalFixture, seedJournalFixture } from './journal-fixture.ts';
import { openOperationJournal } from './operation-journal.ts';
const cleanups: (() => void)[] = [];
afterEach(() => { for (const fn of cleanups.splice(0).reverse()) fn(); });
async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'operation-journal-')); cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const fixture = await seedJournalFixture(dir); cleanups.push(() => fixture.close()); return fixture;
}
const proof = (requestDigest: string) => ({ requestDigest, assertionFingerprint: 'b'.repeat(64), reviewedRevision: 'a'.repeat(64) });
function worker(input: { dir: string; token: string; id: string; requestDigest: string; gate?: string; pause?: 'before_effect' | 'after_effect' | 'after_commit' }) {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, 'journal-worker.ts')], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  child.stdin.write(JSON.stringify(input)); child.stdin.end(); cleanups.push(() => { if (child.exitCode === null) child.kill('SIGKILL'); }); return child;
}
test('preparation persists exact scoped bytes and deduplicates reordered input properties', async () => {
  const s = await setup(), operation = await s.journal.prepare(s.session.token, s.terms);
  const reversed = Object.fromEntries(Object.entries(s.terms).reverse()) as typeof s.terms;
  expect(await s.journal.prepare(s.session.token, reversed)).toEqual(operation);
  expect(operation.canonical).toBe(s.terms.canonical); expect(operation.state).toBe('prepared'); expect(operation.credential).toBe(s.credential);
  s.close(); const reopened = connectJournalFixture(s.dir); cleanups.push(() => reopened.close());
  expect(await reopened.journal.read(s.session.token, operation.id)).toEqual(operation);
  for (const name of readdirSync(s.dir)) expect(readFileSync(join(s.dir, name)).includes(Buffer.from(s.session.token))).toBe(false);
});
test('only one claim is acquired and identical repeats never dispatch again', async () => {
  const s = await setup(), operation = await s.journal.prepare(s.session.token, s.terms);
  expect((await s.journal.claimVerified(s.session.token, operation.id, proof(operation.requestDigest))).acquired).toBe(true);
  expect((await s.journal.claimVerified(s.session.token, operation.id, proof(operation.requestDigest))).acquired).toBe(false);
  await expect(s.journal.claimVerified(s.session.token, operation.id, { ...proof(operation.requestDigest), assertionFingerprint: 'c'.repeat(64) })).rejects.toThrow();
  await expect(s.journal.cancel(s.session.token, operation.id)).rejects.toThrow();
  expect(() => s.journal.refuseBeforeDispatch(operation.id, 'expired')).toThrow();
});
test('changed terms and request or review fingerprints cannot replace the prepared operation', async () => {
  const s = await setup(), operation = await s.journal.prepare(s.session.token, s.terms);
  await expect(s.journal.prepare(s.session.token, { ...s.terms, canonical: s.terms.canonical + 'disputed' })).rejects.toThrow('Offer has another operation');
  for (const change of [{ requestDigest: 'd'.repeat(64) }, { reviewedRevision: 'e'.repeat(64) }]) await expect(s.journal.claimVerified(s.session.token, operation.id, { ...proof(operation.requestDigest), ...change })).rejects.toThrow();
  await expect(s.journal.claimVerified(s.session.token, operation.id, { ...proof(operation.requestDigest), unexpected: true } as ReturnType<typeof proof>)).rejects.toThrow('Invalid operation proof');
  expect((await s.journal.read(s.session.token, operation.id)).state).toBe('prepared');
});
test('expired preparation cannot claim but remains readable and cancellable', async () => {
  const s = await setup(), operation = await s.journal.prepare(s.session.token, s.terms); s.clock.at = 4000;
  await expect(s.journal.claimVerified(s.session.token, operation.id, proof(operation.requestDigest))).rejects.toThrow('Operation expired');
  expect((await s.journal.read(s.session.token, operation.id)).id).toBe(operation.id);
  expect((await s.journal.prepare(s.session.token, s.terms)).id).toBe(operation.id);
  expect((await s.journal.cancel(s.session.token, operation.id)).state).toBe('cancelled');
  const next = await s.journal.prepare(s.session.token, { ...s.terms, expiresAt: 5000 }); expect(next.id).not.toBe(operation.id);
});
test('uncertain and committed outcomes preserve the claim fence and exact receipt identity', async () => {
  const s = await setup(), operation = await s.journal.prepare(s.session.token, s.terms);
  await s.journal.claimVerified(s.session.token, operation.id, proof(operation.requestDigest));
  expect(s.journal.markUncertain(operation.id).state).toBe('uncertain');
  expect((await s.journal.claimVerified(s.session.token, operation.id, proof(operation.requestDigest))).acquired).toBe(false);
  await expect(s.journal.prepare(s.session.token, { ...s.terms, reviewedRevision: 'd'.repeat(64) })).rejects.toThrow();
  expect(() => s.journal.recordCommitted(operation.id, 'e'.repeat(64), 'f'.repeat(64))).toThrow();
  const record = s.journal.recordCommitted(operation.id, 'b'.repeat(64), 'f'.repeat(64)); expect(record.state).toBe('committed');
  expect(s.journal.recordCommitted(operation.id, 'b'.repeat(64), 'f'.repeat(64))).toEqual(record);
  expect(() => s.journal.recordCommitted(operation.id, 'b'.repeat(64), 'e'.repeat(64))).toThrow();
  expect((await s.journal.claimVerified(s.session.token, operation.id, proof(operation.requestDigest))).acquired).toBe(false);
});
test('only pre-dispatch refusal releases the offer slot', async () => {
  const s = await setup(), operation = await s.journal.prepare(s.session.token, s.terms);
  expect(s.journal.refuseBeforeDispatch(operation.id, 'review_changed').state).toBe('refused');
  await expect(s.journal.claimVerified(s.session.token, operation.id, proof(operation.requestDigest))).rejects.toThrow();
  const replacement = await s.journal.prepare(s.session.token, { ...s.terms, reviewedRevision: 'c'.repeat(64) }); expect(replacement.id).not.toBe(operation.id);
});
test('new same-credential session resumes history while revocation and foreign offer scope refuse access', async () => {
  const s = await setup(), operation = await s.journal.prepare(s.session.token, s.terms);
  const replacement = s.authority.createSessionAfterVerification(s.credential, 8000); // trusted renewed-session fixture
  s.authority.revokeSession(s.session.id);
  expect((await s.journal.read(replacement.token, operation.id)).id).toBe(operation.id);
  await expect(s.journal.read(s.session.token, operation.id)).rejects.toThrow();
  s.authority.bindResource({ kind: 'offer', id: 'foreign' }, { household: 'other', presenter: 'merchant-1' });
  await expect(s.journal.prepare(replacement.token, { ...s.terms, offer: 'foreign', canonical: 'valence.statement.1\nforeign\n0' })).rejects.toThrow();
  s.authority.invalidateResource({ kind: 'offer', id: s.terms.offer });
  await expect(s.journal.claimVerified(replacement.token, operation.id, proof(operation.requestDigest))).rejects.toThrow();
  await expect(s.journal.read(replacement.token, operation.id)).rejects.toThrow();
});
test('invalid input and mismatched binding environment are refused', async () => {
  const s = await setup();
  for (const changed of [{ expiresAt: 1000 }, { expiresAt: 999999 }, { reviewedRevision: 'bad' }, { canonical: 'other-offer' }]) await expect(s.journal.prepare(s.session.token, { ...s.terms, ...changed })).rejects.toThrow();
  expect(() => openOperationJournal(join(s.dir, 'wrong.sqlite'), s.authority, { ...s.bindings, scope: { ...s.bindings.scope, environment: 'wrong' } }, { maximumLifetimeMs: 5000 })).toThrow('Operation binding scope mismatch');
});
async function line(child: ReturnType<typeof worker>) {
  const reader = child.stdout.getReader(); let text = '';
  try {
    while (!text.includes('\n')) { const value = await reader.read(); if (value.done) throw new Error('Worker ended before checkpoint'); text += new TextDecoder().decode(value.value); }
    return JSON.parse(text.trim()) as { ready?: boolean; acquired?: boolean };
  } finally { reader.releaseLock(); }
}
test('two synchronised worker processes acquire only one claim and record one synthetic effect', async () => {
  const s = await setup(), operation = await s.journal.prepare(s.session.token, s.terms);
  const input = { dir: s.dir, token: s.session.token, id: operation.id, requestDigest: operation.requestDigest, gate: join(s.dir, 'go') };
  const children = [worker(input), worker(input)];
  const readiness = await Promise.all(children.map(line)); expect(readiness.every(x => x.ready)).toBe(true);
  writeFileSync(input.gate, 'go');
  const output = await Promise.all(children.map(async child => { const result = await line(child); const code = await child.exited; expect(code).toBe(0); return result; }));
  expect(output.filter(x => x.acquired).length).toBe(1);
  expect(readFileSync(join(s.dir, 'synthetic-effects.log'), 'utf8').trim().split('\n')).toEqual([operation.id]);
}, 15000);
test('process death before effect after effect and after receipt never grants another claim', async () => {
  for (const pause of ['before_effect','after_effect','after_commit'] as const) {
    const s = await setup(), operation = await s.journal.prepare(s.session.token, s.terms);
    const child = worker({ dir: s.dir, token: s.session.token, id: operation.id, requestDigest: operation.requestDigest, pause });
    expect((await line(child)).acquired).toBe(true);
    child.kill('SIGKILL'); await child.exited; expect(child.signalCode).toBe('SIGKILL');
    s.close(); const reopened = connectJournalFixture(s.dir); cleanups.push(() => reopened.close());
    expect((await reopened.journal.read(s.session.token, operation.id)).state).toBe(pause === 'after_commit' ? 'committed' : 'dispatching');
    expect((await reopened.journal.claimVerified(s.session.token, operation.id, proof(operation.requestDigest))).acquired).toBe(false);
    if (pause !== 'after_commit') expect(reopened.journal.markUncertain(operation.id).state).toBe('uncertain');
    else expect((await reopened.journal.read(s.session.token, operation.id)).receiptDigest).toBe('f'.repeat(64));
    const path = join(s.dir, 'synthetic-effects.log');
    if (pause === 'before_effect') expect(existsSync(path)).toBe(false);
    else expect(readFileSync(path, 'utf8').trim().split('\n')).toEqual([operation.id]);
  }
}, 15000);

test('altered stored canonical bytes cannot be read or claimed as the original request', async () => {
  const s = await setup(), operation = await s.journal.prepare(s.session.token, s.terms);
  const raw = new Database(join(s.dir, 'journal.sqlite'));
  raw.query('UPDATE operations SET record=? WHERE id=?').run(JSON.stringify({ ...operation, canonical: operation.canonical + 'disputed' }), operation.id); raw.close();
  await expect(s.journal.read(s.session.token, operation.id)).rejects.toThrow('Inconsistent operation storage');
  await expect(s.journal.claimVerified(s.session.token, operation.id, proof(operation.requestDigest))).rejects.toThrow('Inconsistent operation storage');
});
test('reopening rejects wrong environment metadata or a missing unique claim index', async () => {
  const s = await setup(), policy = { maximumLifetimeMs: 5000, now: () => 1000 };
  expect(() => openOperationJournal(join(s.dir, 'journal.sqlite'), { ...s.authority, scope: { ...s.authority.scope, environment: 'other' } }, { ...s.bindings, scope: { ...s.bindings.scope, environment: 'other' } }, policy)).toThrow('Operation scope mismatch');
  const raw = new Database(join(s.dir, 'journal.sqlite')); raw.run('DROP INDEX one_blocking_statement'); raw.close();
  expect(() => openOperationJournal(join(s.dir, 'journal.sqlite'), s.authority, s.bindings, policy)).toThrow('Operation claim index missing');
});
