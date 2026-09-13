import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAtomicStore } from './atomic-store.ts';
import { atomicScope } from './atomic-fixture.ts';
import { openMemberAuthority } from '../member-read/authority.ts';
import { openVerifiedLogin } from '../member-login/login.ts';
import { databaseFor } from './shared-database.ts';
import { seedUnified, unifiedRuntime, commitUnified, inspectUnified, loginResponse, type UnifiedInput } from './unified-fixture.ts';
const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
function fresh() { const dir = mkdtempSync(join(tmpdir(), 'unified-member-')); cleanups.push(() => rmSync(dir, { recursive: true, force: true })); return { dir, path: join(dir, 'member.sqlite') }; }
function open(path: string) { const unit = openAtomicStore(path, atomicScope); cleanups.push(() => unit.close()); return unit; }
const observe = (path: string, input: UnifiedInput) => open(path).run((store, db) => inspectUnified(store, db, input));
test('existing verified login binding operation and actual engine outcome persist in one database', async () => {
  const f = fresh(), { input } = await seedUnified(f.path), unit = open(f.path);
  const result = await unit.run((store, db) => commitUnified(store, db, input));
  expect(result).toMatchObject({ operation: { state: 'committed' }, receipt: { charged: 1200, confirmation: input.statement.signature } });
  expect(await observe(f.path, input)).toMatchObject({ counter: 1, operation: result.operation, receipt: result.receipt, reservation: { status: 'committed', committed: 1200 }, state: 'settled', day: [{ amount: 1200 }] });
  expect(await unit.run((store, db) => commitUnified(store, db, input))).toEqual(result);
  for (const file of readdirSync(f.dir)) expect(readFileSync(join(f.dir, file)).includes(Buffer.from(input.token))).toBe(false);
});
test('committed revocations and resource invalidations refuse before claim and local effects', async () => {
  for (const kind of ['credential', 'session', 'principal', 'grants', 'offer', 'mandate']) {
    const f = fresh(), { input } = await seedUnified(f.path), unit = open(f.path);
    await unit.run((store, db) => {
      const a = unifiedRuntime(store, db).authority;
      if (kind === 'credential') a.revokeCredential(input.credential);
      if (kind === 'session') a.revokeSession(input.session);
      if (kind === 'principal') a.disablePrincipal('member');
      if (kind === 'grants') a.setPresenterGrants('member', []);
      if (kind === 'offer' || kind === 'mandate') a.invalidateResource({ kind, id: kind === 'offer' ? input.statement.offer : 'mandate-1' });
    });
    await expect(unit.run((store, db) => commitUnified(store, db, input))).rejects.toThrow();
    expect(await observe(f.path, input)).toMatchObject({ operation: { state: 'prepared', assertionFingerprint: null }, receipt: null, reservation: { status: 'held' }, day: [] });
  }
});
test('failure after actual engine settlement rolls back operation claim and every local outcome', async () => {
  const f = fresh(), { input } = await seedUnified(f.path), unit = open(f.path);
  await expect(unit.run((store, db) => commitUnified(store, db, input, async at => { if (at === 'engine') throw new Error('injected before outcome'); }))).rejects.toThrow('injected before outcome');
  expect(await observe(f.path, input)).toMatchObject({ operation: { state: 'prepared', assertionFingerprint: null, receiptDigest: null }, receipt: null, reservation: { status: 'held', committed: null }, state: 'decided', day: [] });
});
test('login counter session and challenge consumption roll back together before any token is delivered', async () => {
  const f = fresh(), seeded = await seedUnified(f.path), unit = open(f.path);
  const flow = await unit.run((store, db) => unifiedRuntime(store, db).login.begin());
  const response = loginResponse(seeded.pair, seeded.input.credential, seeded.user, flow.publicKey.challenge, 2);
  let uncommittedToken = '';
  await expect(unit.run(async (store, db) => { uncommittedToken = (await unifiedRuntime(store, db).login.finish(flow.id, response)).token; throw new Error('before delivery'); })).rejects.toThrow('before delivery');
  expect((await observe(f.path, seeded.input)).counter).toBe(1);
  expect(await unit.run((store, db) => unifiedRuntime(store, db).authority.resolveSession(uncommittedToken))).toBeUndefined();
  const session = await unit.run((store, db) => unifiedRuntime(store, db).login.finish(flow.id, response));
  expect((await observe(f.path, seeded.input)).counter).toBe(2);
  expect(await unit.run((store, db) => unifiedRuntime(store, db).authority.resolveSession(session.token))).toMatchObject({ household: 'house' });
});
test('caught login verification failures commit the consumed challenge and issue no session', async () => {
  const f = fresh(), seeded = await seedUnified(f.path), unit = open(f.path);
  const flow = await unit.run((store, db) => unifiedRuntime(store, db).login.begin());
  const response = loginResponse(seeded.pair, seeded.input.credential, seeded.user, 'wrong-challenge', 2);
  const result = await unit.run(async (store, db) => { try { await unifiedRuntime(store, db).login.finish(flow.id, response); return true; } catch { return false; } });
  expect(result).toBe(false);
  expect(await unit.run((_store, database) => databaseFor(database, atomicScope).db.query('SELECT id FROM challenges WHERE id=?').get(flow.id))).toBeNull();
  expect((await observe(f.path, seeded.input)).counter).toBe(1);
});
test('two login flows with the same nonzero authenticator counter issue only one new session', async () => {
  const f = fresh(), seeded = await seedUnified(f.path), a = open(f.path), b = open(f.path);
  const flows = await a.run((store, db) => { const login = unifiedRuntime(store, db).login; return [login.begin(), login.begin()]; });
  const results = await Promise.all(flows.map((flow, i) => (i ? b : a).run(async (store, db) => {
    try { await unifiedRuntime(store, db).login.finish(flow.id, loginResponse(seeded.pair, seeded.input.credential, seeded.user, flow.publicKey.challenge, 2)); return true; } catch { return false; }
  })));
  expect(results.filter(Boolean)).toHaveLength(1); expect((await observe(f.path, seeded.input)).counter).toBe(2);
});
test('shared capabilities reject expired use mixed participants and standalone reopening', async () => {
  const f = fresh(), { input } = await seedUnified(f.path), unit = open(f.path); let escaped: ReturnType<typeof unifiedRuntime> | undefined;
  await unit.run((store, db) => { escaped = unifiedRuntime(store, db); escaped.authority.close(); expect(escaped.authority.transactionContext(input.token, 'mandate-1')).toBeDefined(); });
  expect(() => escaped!.authority.revokeCredential(input.credential)).toThrow('scope ended');
  await expect(escaped!.journal.read(input.token, input.operation.id)).rejects.toThrow('scope ended');
  await unit.run((_store, db) => {
    expect(() => openVerifiedLogin(db, escaped!.authority, { environment: 'test', origin: atomicScope.audience, rpID: 'unit.example', challengeLifetimeMs: 1000, sessionLifetimeMs: 1000 })).toThrow('Mixed');
    expect(() => databaseFor(db, { ...atomicScope, environment: 'other' })).toThrow('scope mismatch');
    const authority = openMemberAuthority(db, { ...atomicScope, maxSessionLifetimeMs: 10000 });
    expect(() => openVerifiedLogin(join(f.dir, 'mixed.sqlite'), authority, { environment: 'test', origin: atomicScope.audience, rpID: 'unit.example', challengeLifetimeMs: 1000, sessionLifetimeMs: 1000 })).toThrow('Mixed');
  });
  expect(() => openMemberAuthority(f.path, { ...atomicScope, maxSessionLifetimeMs: 10000 })).toThrow('schema');
  expect((await observe(f.path, input)).operation.state).toBe('prepared');
});
function worker(path: string, input: UnifiedInput, action: 'settle' | 'revoke', gate: string, release: string, pause?: string) {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, 'unified-worker.ts')], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  cleanups.push(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  child.stdin.write(JSON.stringify({ path, input, action, gate, release, pause })); child.stdin.end();
  const reader = child.stdout.getReader(); let buffer = '';
  async function line(): Promise<any> {
    const deadline = performance.now() + 5000;
    while (!buffer.includes('\n')) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([reader.read(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Worker deadline')), Math.max(1, deadline - performance.now())); })]);
        if (result.done) throw new Error('Worker stopped: ' + await new Response(child.stderr).text());
        buffer += new TextDecoder().decode(result.value);
      } finally { clearTimeout(timer); }
    }
    const at = buffer.indexOf('\n'), value = JSON.parse(buffer.slice(0, at)); buffer = buffer.slice(at + 1); return value;
  }
  return { child, line };
}
test('separate processes order revocation before settlement and settlement before revocation', async () => {
  for (const firstAction of ['revoke', 'settle'] as const) {
    const f = fresh(), { input } = await seedUnified(f.path), gate1 = join(f.dir, 'gate1'), gate2 = join(f.dir, 'gate2'), release = join(f.dir, 'release');
    const first = worker(f.path, input, firstAction, gate1, release, firstAction === 'revoke' ? 'revoked' : 'claimed');
    const second = worker(f.path, input, firstAction === 'revoke' ? 'settle' : 'revoke', gate2, release);
    expect(await first.line()).toEqual({ ready: true }); expect(await second.line()).toEqual({ ready: true });
    writeFileSync(gate1, 'go'); expect(await first.line()).toEqual({ checkpoint: firstAction === 'revoke' ? 'revoked' : 'claimed' });
    writeFileSync(gate2, 'go'); let finished = false; const pending = second.line().then(value => { finished = true; return value; });
    await Bun.sleep(25); expect(finished).toBe(false); writeFileSync(release, 'go');
    expect((await first.line()).ok).toBe(true); expect((await pending).ok).toBe(firstAction !== 'revoke');
    expect(await first.child.exited).toBe(0); expect(await second.child.exited).toBe(0);
    const observed = await observe(f.path, input);
    expect(observed.operation.state).toBe(firstAction === 'revoke' ? 'prepared' : 'committed');
    expect(observed.receipt?.charged ?? 0).toBe(firstAction === 'revoke' ? 0 : 1200);
    await expect(open(f.path).run((store, db) => unifiedRuntime(store, db).journal.read(input.token, input.operation.id))).rejects.toThrow();
  }
});
test('SIGKILL rolls back claim engine and outcome together or preserves the complete committed result', async () => {
  for (const pause of ['claimed', 'engine', 'outcome', 'committed']) {
    const f = fresh(), { input } = await seedUnified(f.path), gate = join(f.dir, 'go');
    const w = worker(f.path, input, 'settle', gate, join(f.dir, 'never-release'), pause);
    expect(await w.line()).toEqual({ ready: true }); writeFileSync(gate, 'go'); expect(await w.line()).toEqual({ checkpoint: pause });
    w.child.kill('SIGKILL'); await w.child.exited; expect(w.child.signalCode).toBe('SIGKILL');
    const before = await observe(f.path, input);
    expect(before).toMatchObject(pause === 'committed' ? { operation: { state: 'committed' }, state: 'settled', receipt: { charged: 1200 }, reservation: { status: 'committed' }, day: [{ amount: 1200 }] } : { operation: { state: 'prepared', assertionFingerprint: null, receiptDigest: null }, state: 'decided', receipt: null, reservation: { status: 'held' }, day: [] });
    const after = await open(f.path).run((store, db) => commitUnified(store, db, input));
    expect(after.receipt.charged).toBe(1200); if (before.receipt) expect(after.receipt).toEqual(before.receipt);
    expect((await observe(f.path, input)).day).toHaveLength(1);
  }
});
