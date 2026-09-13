// Test-only separate process. Only fixture public signatures arrive over stdin.
import { existsSync, writeSync } from 'node:fs';
import { openAtomicStore } from './atomic-store.ts';
import { atomicScope, settleFixture, type FixtureStatement } from './atomic-fixture.ts';
import type { Store } from '../../engine/src/common/store.ts';
const input = JSON.parse(await Bun.stdin.text()) as { path: string; statement: FixtureStatement; gate?: string; pause?: string };
const unit = openAtomicStore(input.path, atomicScope);
function stop(at: string) {
  writeSync(1, JSON.stringify({ checkpoint: at }) + '\n');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
}
try {
  if (input.gate) {
    writeSync(1, '{"ready":true}\n');
    while (!existsSync(input.gate)) await Bun.sleep(5);
  }
  const receipt = await unit.run(store => {
    const instrumented: Store = {
      map<T>(name: string) {
        const map = store.map<T>(name), set = map.set.bind(map);
        map.set = (key: string, value: T) => { const result = set(key, value); if (input.pause === name) stop(name); return result; };
        return map;
      }, close: store.close,
    };
    return settleFixture(instrumented, input.statement);
  });
  if (input.pause === 'committed') stop('committed');
  writeSync(1, JSON.stringify({ receipt }) + '\n');
} catch (error) {
  const code = (error as { code?: string }).code;
  writeSync(1, JSON.stringify({ refused: code ?? 'internal_failure' }) + '\n');
} finally { unit.close(); }
