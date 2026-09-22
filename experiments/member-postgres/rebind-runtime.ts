import { readFileSync, openSync, closeSync, fstatSync, constants } from 'node:fs';
import { createPool, postgresStore, type Identity } from './store.ts';
import { memberRuntimeIdentity, type MemberRuntimeConfig } from './config.ts';

export type RebindPlan = { identity: Identity; config: MemberRuntimeConfig };
type BoundIdentity = { profile: string; config: Record<string, unknown>; fingerprint: string };
export type RebindAction = 'dry-run' | 'rebound' | 'already bound';
export type RebindResult = { ok: true; deployment: string; from: string; to: string; action: RebindAction; differing: string[] };

const refuse = (): never => { throw new Error('Rebind command refused'); };

/**
 * The profile transitions this command may apply, and the fields each one is
 * permitted to add. Only one exists today: #41 raised the profile from .1 to
 * .2 by adding `androidAppOrigins`, so a deployment still bound to .1 needs
 * exactly this move before its build can promote. A future profile bump adds
 * a row; it never widens or removes one already here, and there is no route
 * back to an earlier profile.
 */
const ALLOWED_TRANSITIONS: Record<string, { to: string; additions: Record<string, unknown> }> = {
 'atarasy.member-runtime.1': { to: 'atarasy.member-runtime.2', additions: { androidAppOrigins: [] } },
};

export function readRebindPlan(path: string): RebindPlan {
 const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
 try {
  const stat = fstatSync(fd);
  if (!stat.isFile() || stat.size > 65536) refuse();
  const plan = JSON.parse(readFileSync(fd, 'utf8'));
  if (!plan || Object.keys(plan).sort().join(',') !== 'config,identity') refuse();
  if (!plan.identity || Object.keys(plan.identity).sort().join(',') !== 'environment,epoch,id,origin') refuse();
  return plan;
 } finally { closeSync(fd); }
}

/** Keys whose value differs between `old` and `next`, including a key only one of them holds, skipping any key named in `skip`. Comparison is per key, never of the whole object, so unrelated key ordering in a value read back from storage cannot manufacture a difference. */
function differingKeys(old: Record<string, unknown>, next: Record<string, unknown>, skip: ReadonlySet<string>): string[] {
 const changed: string[] = [];
 for (const key of new Set([...Object.keys(old), ...Object.keys(next)])) {
  if (skip.has(key)) continue;
  if (JSON.stringify(old[key]) !== JSON.stringify(next[key])) changed.push(key);
 }
 return changed.sort();
}

/**
 * Rebind a deployment's `member_config/current` from an old runtime profile
 * to a new one, inside the application's own store lock. `write` false is a
 * dry run: every refusal and the reported action are computed exactly as
 * they would be applied, but `member_config` is never touched.
 */
export async function runRebindCommand(plan: RebindPlan, env: Record<string, string | undefined>, write: boolean): Promise<RebindResult> {
 const sourceURL = env.ATARASY_MIGRATION_SOURCE_URL;
 if (!sourceURL) refuse();
 if (new URL(sourceURL).hostname.includes('-pooler')) refuse(); // matches migrate.ts: pooled connections do not see a consistent lock
 const next = memberRuntimeIdentity(plan.config); // throws on an incomplete or malformed config
 const pool = createPool(sourceURL);
 try {
  return await postgresStore(pool, plan.identity).run(store => {
   const config = store.map<BoundIdentity>('member_config');
   const old = config.get('current');
   if (!old || typeof old.profile !== 'string' || !old.config || typeof old.config !== 'object') refuse();
   const bound = old as BoundIdentity;
   if (bound.profile === next.profile && differingKeys(bound.config, next.config, new Set()).length === 0) {
    return { ok: true, deployment: plan.identity.id, from: bound.profile, to: next.profile, action: 'already bound', differing: [] };
   }
   const allowed = ALLOWED_TRANSITIONS[bound.profile];
   if (!allowed || allowed.to !== next.profile) refuse(); // no route for this source profile, including any downgrade
   const additions = Object.keys(allowed!.additions);
   for (const key of additions) {
    if (JSON.stringify((next.config as Record<string, unknown>)[key]) !== JSON.stringify(allowed!.additions[key])) refuse();
   }
   if (differingKeys(bound.config, next.config, new Set(additions)).length) refuse(); // every key besides the addition must be identical
   if (write) config.set('current', next);
   return { ok: true, deployment: plan.identity.id, from: bound.profile, to: next.profile, action: write ? 'rebound' : 'dry-run', differing: additions.sort() };
  });
 } finally { await pool.end(); }
}

if (import.meta.main) {
 try {
  const [path, flag, ...extra] = process.argv.slice(2);
  if (!path || extra.length || (flag !== undefined && flag !== '--write')) refuse();
  const result = await runRebindCommand(readRebindPlan(path!), process.env, flag === '--write');
  process.stdout.write(JSON.stringify(result) + '\n');
 } catch { process.stderr.write(JSON.stringify({ ok: false, error: 'rebind_failed', next: 'Run without --write to inspect the binding before applying it. No rebind was applied.' }) + '\n'); process.exitCode = 1; }
}
