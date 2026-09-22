import { beforeAll, afterAll, expect, test } from 'bun:test';
import { randomUUID, randomBytes } from 'node:crypto';
import { createPool, initialiseDeployment, postgresStore, type Identity } from './store.ts';
import { migrateDatabase } from './migrate.ts';
import { openPostgresMemberHTTP } from './http.ts';
import { memberRuntimeIdentity, type MemberRuntimeConfig } from './config.ts';
import { runRebindCommand } from './rebind-runtime.ts';

const url = process.env.ATARASY_TEST_POSTGRES_URL;
if (!url) throw new Error('Explicit isolated ATARASY_TEST_POSTGRES_URL required');
const pool = createPool(url), ids: string[] = [];
// The shape `atarasy.member-runtime.1` actually had: every field of today's
// MemberRuntimeConfig except `androidAppOrigins`, which #41 introduced.
const oldShapeConfig = {
 environment: 'test', origin: 'https://unit.example', rpID: 'unit.example',
 explorationRate: 0.2, reminderLimit: 1 as const, recoveryGraceDays: 3, dayBoundary: 'UTC' as const,
 maximumLifetimeMs: 60000, maxSessionLifetimeMs: 100000, maximumBodyBytes: 20000,
 bodyTimeoutMs: 100, maximumPending: 8, budgetWindowMs: 60000, maximumRequests: 100, maximumTrackedTokens: 100,
};
const env = { ATARASY_MIGRATION_SOURCE_URL: url };

beforeAll(() => migrateDatabase(url!));
afterAll(async () => {
 for (const id of ids) { await pool.query('DELETE FROM atarasy_member.engine_rows WHERE deployment=$1', [id]); await pool.query('DELETE FROM atarasy_member.control WHERE id=$1', [id]); }
 await pool.end();
});

/** A deployment bound to the old profile, exactly as #41 found every live one. */
async function boundToV1(overrides: Partial<typeof oldShapeConfig> = {}) {
 const identity: Identity = { id: 'rebind_' + randomUUID().replaceAll('-', ''), environment: 'test', origin: 'https://unit.example', epoch: 1 };
 ids.push(identity.id);
 await initialiseDeployment(pool, identity);
 const unit = postgresStore(pool, identity), oldConfig = { ...oldShapeConfig, ...overrides };
 await unit.run(store => { store.map('member_config').set('current', { profile: 'atarasy.member-runtime.1', config: oldConfig, fingerprint: 'f'.repeat(64) }); });
 return { identity, unit, oldConfig };
}
const boundRow = (unit: ReturnType<typeof postgresStore>) => unit.run(store => store.map<{ profile: string }>('member_config').get('current'));

test('dry run reports the transition and writes nothing', async () => {
 const { identity, unit, oldConfig } = await boundToV1();
 const plan = { identity, config: { ...oldConfig, androidAppOrigins: [] } as MemberRuntimeConfig };
 const result = await runRebindCommand(plan, env, false);
 expect(result).toEqual({ ok: true, deployment: identity.id, from: 'atarasy.member-runtime.1', to: 'atarasy.member-runtime.2', action: 'dry-run', differing: ['androidAppOrigins'] });
 expect((await boundRow(unit))!.profile).toBe('atarasy.member-runtime.1');
});

test('--write rebinds, and a subsequent openPostgresMemberHTTP with the .2 config starts', async () => {
 const { identity, oldConfig } = await boundToV1();
 const newConfig = { ...oldConfig, androidAppOrigins: [] } as MemberRuntimeConfig;
 const result = await runRebindCommand({ identity, config: newConfig }, env, true);
 expect(result.action).toBe('rebound');
 const app = await openPostgresMemberHTTP(pool, identity, newConfig);
 expect(app.descriptor.fingerprint).toBe(memberRuntimeIdentity(newConfig).fingerprint);
});

test('refuses when a key besides androidAppOrigins differs from the bound config', async () => {
 const { identity, unit, oldConfig } = await boundToV1();
 const plan = { identity, config: { ...oldConfig, androidAppOrigins: [], explorationRate: 0.4 } as MemberRuntimeConfig };
 await expect(runRebindCommand(plan, env, false)).rejects.toThrow('Rebind command refused');
 expect((await boundRow(unit))!.profile).toBe('atarasy.member-runtime.1');
});

test('refuses when androidAppOrigins is not the empty list the transition allows', async () => {
 const { identity, oldConfig } = await boundToV1();
 const origin = 'android:apk-key-hash:' + randomBytes(32).toString('base64url');
 const plan = { identity, config: { ...oldConfig, androidAppOrigins: [origin] } as MemberRuntimeConfig };
 await expect(runRebindCommand(plan, env, false)).rejects.toThrow('Rebind command refused');
});

test('refuses an unknown source profile, including a downgrade', async () => {
 const { identity, unit, oldConfig } = await boundToV1();
 await unit.run(store => { store.map('member_config').set('current', { profile: 'atarasy.member-runtime.0', config: oldConfig, fingerprint: '0'.repeat(64) }); });
 const plan = { identity, config: { ...oldConfig, androidAppOrigins: [] } as MemberRuntimeConfig };
 await expect(runRebindCommand(plan, env, false)).rejects.toThrow('Rebind command refused');
});

test('refuses an outside-the-allow-list source profile even when its stored config already matches the target', async () => {
 // Isolates the allow-list check from the "every other key identical" check:
 // here nothing else would refuse, because the bound config is already
 // byte-for-byte what the plan asks for. Only the profile label is wrong.
 const { identity, unit, oldConfig } = await boundToV1();
 const newConfig = { ...oldConfig, androidAppOrigins: [] } as MemberRuntimeConfig;
 await unit.run(store => { store.map('member_config').set('current', { profile: 'unexpected-profile', config: newConfig, fingerprint: 'e'.repeat(64) }); });
 await expect(runRebindCommand({ identity, config: newConfig }, env, true)).rejects.toThrow('Rebind command refused');
 expect((await boundRow(unit))!.profile).toBe('unexpected-profile');
});

test('refuses when the deployment has no binding yet', async () => {
 const identity: Identity = { id: 'rebind_' + randomUUID().replaceAll('-', ''), environment: 'test', origin: 'https://unit.example', epoch: 1 };
 ids.push(identity.id);
 await initialiseDeployment(pool, identity);
 const plan = { identity, config: { ...oldShapeConfig, androidAppOrigins: [] } as MemberRuntimeConfig };
 await expect(runRebindCommand(plan, env, false)).rejects.toThrow('Rebind command refused');
});

test('a second run after --write reports already bound and writes nothing further', async () => {
 const { identity, oldConfig } = await boundToV1();
 const newConfig = { ...oldConfig, androidAppOrigins: [] } as MemberRuntimeConfig;
 const plan = { identity, config: newConfig };
 await runRebindCommand(plan, env, true);
 const second = await runRebindCommand(plan, env, true);
 expect(second).toEqual({ ok: true, deployment: identity.id, from: 'atarasy.member-runtime.2', to: 'atarasy.member-runtime.2', action: 'already bound', differing: [] });
});

test('CLI emits a bounded summary, a dry run leaves the binding untouched, and driver failures are redacted', async () => {
 const { identity, unit, oldConfig } = await boundToV1();
 const newConfig = { ...oldConfig, androidAppOrigins: [] } as MemberRuntimeConfig;
 const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs'), { tmpdir } = await import('node:os'), { join } = await import('node:path');
 const dir = mkdtempSync(join(tmpdir(), 'rebind-command-')), plan = join(dir, 'plan.json');
 writeFileSync(plan, JSON.stringify({ identity, config: newConfig }));
 const cli = new URL('./rebind-runtime.ts', import.meta.url).pathname;
 try {
  const invoke = async (args: string[], invokeEnv: Record<string, string>) => {
   const child = Bun.spawn([process.execPath, cli, ...args], { env: { PATH: process.env.PATH!, ...invokeEnv }, stdout: 'pipe', stderr: 'pipe' });
   const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
   return { out, err, code };
  };
  const dry = await invoke([plan], env);
  expect(dry.code).toBe(0); expect(JSON.parse(dry.out)).toMatchObject({ ok: true, action: 'dry-run' }); expect(dry.err).toBe('');
  expect((await boundRow(unit))!.profile).toBe('atarasy.member-runtime.1');
  const written = await invoke([plan, '--write'], env);
  expect(written.code).toBe(0); expect(JSON.parse(written.out)).toMatchObject({ ok: true, action: 'rebound' });
  expect((await boundRow(unit))!.profile).toBe('atarasy.member-runtime.2');
  const bad = await invoke([plan, '--write'], { ATARASY_MIGRATION_SOURCE_URL: 'postgres://do-not-print-password@127.0.0.1:1/missing' });
  expect(bad.code).toBe(1); expect(bad.out).toBe('');
  expect(JSON.parse(bad.err).error).toBe('rebind_failed');
  expect(bad.err).not.toContain('do-not-print-password'); expect(bad.err).not.toContain('127.0.0.1');
 } finally { rmSync(dir, { recursive: true, force: true }); }
});
