// Test-only child process. Input bearer travels over stdin, not argv or output.
import { appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { connectJournalFixture } from './journal-fixture.ts';
const input = JSON.parse(await Bun.stdin.text()) as { dir: string; token: string; id: string; requestDigest: string; gate?: string; pause?: 'before_effect' | 'after_effect' | 'after_commit' };
const fixture = connectJournalFixture(input.dir);
async function pause(value: unknown) {
  await Bun.write(Bun.stdout, JSON.stringify(value) + '\n');
  setInterval(() => {}, 1000); await new Promise(() => {});
}
try {
  if (input.gate) {
    await Bun.write(Bun.stdout, '{"ready":true}\n');
    while (!existsSync(input.gate)) await Bun.sleep(5);
  }
  const result = await fixture.journal.claimVerified(input.token, input.id, { requestDigest: input.requestDigest, assertionFingerprint: 'b'.repeat(64), reviewedRevision: 'a'.repeat(64) });
  if (input.pause === 'before_effect') await pause({ acquired: result.acquired });
  if (result.acquired) appendFileSync(join(input.dir, 'synthetic-effects.log'), input.id + '\n');
  if (input.pause === 'after_commit') fixture.journal.recordCommitted(input.id, 'b'.repeat(64), 'f'.repeat(64));
  if (input.pause) await pause({ acquired: result.acquired });
  await Bun.write(Bun.stdout, JSON.stringify({ acquired: result.acquired, state: result.operation.state }) + '\n');
} finally { fixture.close(); }
