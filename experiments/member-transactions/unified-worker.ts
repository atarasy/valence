// Test-only process. Bearer credentials travel over stdin and are never logged.
import { existsSync, writeSync } from 'node:fs';
import { openAtomicStore } from './atomic-store.ts';
import { atomicScope } from './atomic-fixture.ts';
import { commitUnified, unifiedRuntime, type UnifiedInput } from './unified-fixture.ts';
const args = JSON.parse(await Bun.stdin.text()) as { path: string; input: UnifiedInput; action: 'settle' | 'revoke'; gate: string; pause?: string; release: string };
const unit = openAtomicStore(args.path, atomicScope);
async function checkpoint(at: string) {
  if (args.pause !== at) return;
  writeSync(1, JSON.stringify({ checkpoint: at }) + '\n');
  while (!existsSync(args.release)) await Bun.sleep(5);
}
try {
  writeSync(1, '{"ready":true}\n'); while (!existsSync(args.gate)) await Bun.sleep(5);
  const result = await unit.run(async (store, database) => {
    if (args.action === 'settle') return commitUnified(store, database, args.input, checkpoint);
    unifiedRuntime(store, database).authority.revokeCredential(args.input.credential); await checkpoint('revoked'); return { revoked: true };
  });
  await checkpoint('committed'); writeSync(1, JSON.stringify({ ok: true, result }) + '\n');
} catch { writeSync(1, '{"ok":false}\n'); }
finally { unit.close(); }
