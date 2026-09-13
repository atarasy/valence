import { afterEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Store } from '../../engine/src/common/store.ts';
import { openAtomicStore } from './atomic-store.ts';
import { atomicScope, seedAtomicFixture, settleFixture, inspectFixture, localRuntime, fixtureTime, type FixtureStatement } from './atomic-fixture.ts';
const cleanups: (() => void)[] = [];
afterEach(() => { for (const clean of cleanups.splice(0).reverse()) clean(); });
function fresh() { const dir = mkdtempSync(join(tmpdir(), 'atomic-engine-')); cleanups.push(() => rmSync(dir, { recursive: true, force: true })); return { dir, path: join(dir, 'engine.sqlite') }; }
function open(path: string, timeout = 5000) { const unit = openAtomicStore(path, atomicScope, timeout); cleanups.push(() => unit.close()); return unit; }
function observe(path: string, offer: string) { return open(path).run(store => inspectFixture(store, offer)); }
function throwAfter(store: Store, namespace: string): Store {
  return { map<T>(name: string) {
    const map = store.map<T>(name), set = map.set.bind(map);
    map.set = (k, v) => { const result = set(k, v); if (name === namespace) throw new Error('injected local failure'); return result; };
    return map;
  }, close: store.close };
}
test('actual physical engine settlement commits reservation receipt household day and offer together', async () => {
  const f = fresh(), [statement] = await seedAtomicFixture(f.path), unit = open(f.path);
  const receipt = await unit.run(store => settleFixture(store, statement!));
  expect(receipt).toMatchObject({ charged: 1200, confirmation: statement!.signature, consumed_amount: 1200 });
  const state = await observe(f.path, statement!.offer);
  expect(state).toMatchObject({ state: 'settled', reservation: { status: 'committed', committed: 1200 }, receipt, day: [{ amount: 1200, offer: statement!.offer }] });
  expect(await unit.run(store => settleFixture(store, statement!))).toEqual(receipt);
  expect((await observe(f.path, statement!.offer)).day).toHaveLength(1);
});
test('local failure after ledger or receipt or day write rolls back all engine records', async () => {
  for (const at of ['reservations', 'settlements', 'household_settled']) {
    const f = fresh(), [statement] = await seedAtomicFixture(f.path), unit = open(f.path);
    await expect(unit.run(store => settleFixture(throwAfter(store, at), statement!))).rejects.toThrow('injected local failure');
    expect(await observe(f.path, statement!.offer)).toMatchObject({ state: 'decided', reservation: { status: 'held', committed: null }, receipt: null, day: [] });
    expect((await unit.run(store => settleFixture(store, statement!))).charged).toBe(1200);
  }
});
test('fresh engine on every transaction sees another connection settlement and rejects changed confirmation', async () => {
  const f = fresh(), [statement] = await seedAtomicFixture(f.path), a = open(f.path), b = open(f.path);
  expect((await b.run(store => inspectFixture(store, statement!.offer))).receipt).toBeNull();
  const receipt = await a.run(store => settleFixture(store, statement!));
  expect(await b.run(store => settleFixture(store, statement!))).toEqual(receipt);
  await expect(b.run(store => settleFixture(store, { ...statement!, signature: 'different' }))).rejects.toMatchObject({ code: 'already_settled' });
});
test('waiting same-process connections do not block the owner local awaits and enforce the shared day', async () => {
  const f = fresh(), statements = await seedAtomicFixture(f.path, 2, 1500), a = open(f.path), b = open(f.path);
  const outcomes = await Promise.allSettled([a.run(async store => { await Bun.sleep(20); return settleFixture(store, statements[0]!); }), b.run(store => settleFixture(store, statements[1]!))]);
  expect(outcomes.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(outcomes.find(r => r.status === 'rejected')).toMatchObject({ reason: { code: 'mandate_ceiling_daily' } });
  expect((await observe(f.path, statements[0]!.offer)).day).toHaveLength(1);
});
test('failed serialisation rolls back and returned values or escaped scopes cannot mutate persisted records', async () => {
  const f = fresh(), unit = open(f.path); let escaped: Store | undefined, map: Map<string, { n: number }> | undefined;
  const value = await unit.run(store => { escaped = store; map = store.map('values'); map.set('one', { n: 1 }); return map.get('one')!; });
  value.n = 7; map!.get('one')!.n = 8;
  expect(() => map!.set('two', { n: 2 })).toThrow('scope ended');
  expect(() => map!.delete('one')).toThrow('scope ended'); expect(() => map!.clear()).toThrow('scope ended'); expect(() => escaped!.map('later')).toThrow('scope ended');
  expect(await unit.run(store => store.map('values').get('one'))).toEqual({ n: 1 });
  await expect(unit.run(store => { store.map('values').set('one', { n: 9 }); return () => 1; })).rejects.toThrow();
  expect(await unit.run(store => store.map('values').get('one'))).toEqual({ n: 1 });
});
test('scope schema duplicate maps nested runs and lock timeout fail closed', async () => {
  const f = fresh(), unit = open(f.path), contender = open(f.path, 15);
  expect(() => openAtomicStore(f.path, { ...atomicScope, environment: 'other' })).toThrow('scope mismatch');
  await expect(unit.run(store => { store.map('one'); store.map('one'); })).rejects.toThrow('duplicate');
  await unit.run(async () => {
    expect(() => unit.close()).toThrow('still running');
    await expect(unit.run(() => 1)).rejects.toThrow('unavailable');
    await expect(contender.run(() => 1)).rejects.toThrow('lock timeout');
  });
  expect(await contender.run(() => 'recovered')).toBe('recovered');
  const wrong = fresh(), db = new Database(wrong.path); db.run('CREATE TABLE foreign_rows(k TEXT)'); db.close();
  expect(() => openAtomicStore(wrong.path, atomicScope)).toThrow('schema');
});
// Child readers retain their stream; checkpoint and completion have explicit deadlines.
function worker(path: string, statement: FixtureStatement, options: { gate?: string; pause?: string } = {}) {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, 'atomic-worker.ts')], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  cleanups.push(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  child.stdin.write(JSON.stringify({ path, statement, ...options })); child.stdin.end();
  const reader = child.stdout.getReader(); let buffer = '';
  async function line(): Promise<any> {
    const deadline = performance.now() + 5000;
    while (!buffer.includes('\n')) {
      const remaining = deadline - performance.now(); if (remaining <= 0) throw new Error('Worker deadline');
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const next = await Promise.race([reader.read(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Worker deadline')), remaining); })]);
        if (next.done) throw new Error('Worker stopped: ' + await new Response(child.stderr).text());
        buffer += new TextDecoder().decode(next.value);
      } finally { clearTimeout(timer); }
    }
    const at = buffer.indexOf('\n'), value = JSON.parse(buffer.slice(0, at)); buffer = buffer.slice(at + 1); return value;
  }
  return { child, line };
}
test('two barrier-synchronised processes settle the same actual offer to the same receipt', async () => {
  const f = fresh(), [statement] = await seedAtomicFixture(f.path), gate = join(f.dir, 'go');
  const a = worker(f.path, statement!, { gate }), b = worker(f.path, statement!, { gate });
  expect(await a.line()).toEqual({ ready: true }); expect(await b.line()).toEqual({ ready: true }); writeFileSync(gate, 'go');
  const [one, two] = await Promise.all([a.line(), b.line()]);
  expect(one.receipt.charged).toBe(1200); expect(two.receipt).toEqual(one.receipt);
  expect(await a.child.exited).toBe(0); expect(await b.child.exited).toBe(0);
  expect((await observe(f.path, statement!.offer)).day).toHaveLength(1);
});
test('two barrier-synchronised processes cannot spend the shared daily ceiling on different offers', async () => {
  const f = fresh(), statements = await seedAtomicFixture(f.path, 2, 1500), gate = join(f.dir, 'go');
  const a = worker(f.path, statements[0]!, { gate }), b = worker(f.path, statements[1]!, { gate });
  expect(await a.line()).toEqual({ ready: true }); expect(await b.line()).toEqual({ ready: true }); writeFileSync(gate, 'go');
  const outcomes = await Promise.all([a.line(), b.line()]);
  expect(outcomes.filter(o => o.receipt)).toHaveLength(1); expect(outcomes.find(o => o.refused)).toEqual({ refused: 'mandate_ceiling_daily' });
  expect(await a.child.exited).toBe(0); expect(await b.child.exited).toBe(0);
  expect((await observe(f.path, statements[0]!.offer)).day).toHaveLength(1);
});
test('observed SIGKILL at three internal writes rolls back; after commit preserves all actual engine records', async () => {
  for (const at of ['reservations', 'settlements', 'household_settled', 'committed']) {
    const f = fresh(), [statement] = await seedAtomicFixture(f.path), w = worker(f.path, statement!, { pause: at });
    expect(await w.line()).toEqual({ checkpoint: at }); w.child.kill('SIGKILL'); await w.child.exited;
    expect(w.child.signalCode).toBe('SIGKILL');
    const state = await observe(f.path, statement!.offer);
    if (at === 'committed') {
      expect(state).toMatchObject({ state: 'settled', reservation: { status: 'committed', committed: 1200 }, receipt: { charged: 1200, confirmation: statement!.signature }, day: [{ amount: 1200 }] });
    } else {
      expect(state).toMatchObject({ state: 'decided', reservation: { status: 'held', committed: null }, receipt: null, day: [] });
    }
    // Safe only for this rolled-back local ledger. The separate member journal is not reset.
    const receipt = await open(f.path).run(store => settleFixture(store, statement!));
    expect(receipt.charged).toBe(1200);
    if (state.receipt) expect(receipt).toEqual(state.receipt);
    expect((await observe(f.path, statement!.offer)).day).toHaveLength(1);
  }
});
test('a competing withdrawal is ordered against settlement under the same boundary', async () => {
  const f = fresh(), [statement] = await seedAtomicFixture(f.path), a = open(f.path), b = open(f.path);
  const receipt = a.run(async store => { await Bun.sleep(15); return settleFixture(store, statement!); });
  const withdrawal = b.run(store => localRuntime(store).engine.withdraw(statement!.offer, fixtureTime + 2));
  expect((await receipt).charged).toBe(1200); await expect(withdrawal).rejects.toMatchObject({ code: 'bad_state' });
  expect((await observe(f.path, statement!.offer)).reservation?.status).toBe('committed');
});
