import { Database } from 'bun:sqlite';
import { sharedDatabase, sharedTableGroups, type SharedDatabase } from './shared-database.ts';
import type { Store } from '../../engine/src/common/store.ts';

/** Internal local-only unit of work. Never put remote effects or detached async work inside run. */
export function openAtomicStore(path: string, scope: { environment: string; audience: string }, lockTimeoutMs = 5000) {
  if (!scope.environment || !scope.audience || !Number.isSafeInteger(lockTimeoutMs) || lockTimeoutMs <= 0) throw new Error('Invalid atomic store policy');
  const pinnedScope = Object.freeze({ environment: scope.environment, audience: scope.audience });
  const fixedScope = JSON.stringify(['atarasy.local-engine-unit.1', pinnedScope.environment, pinnedScope.audience]);
  const db = new Database(path, { create: true, strict: true });
  try {
    db.run('PRAGMA busy_timeout=5000'); db.run('PRAGMA foreign_keys=ON');
    db.transaction(() => {
      const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
      if (!tables.length) {
        db.run('CREATE TABLE atomic_meta(scope TEXT NOT NULL); CREATE TABLE atomic_rows(namespace TEXT NOT NULL,k TEXT NOT NULL,v TEXT NOT NULL,PRIMARY KEY(namespace,k));');
        db.query('INSERT INTO atomic_meta VALUES (?)').run(fixedScope);
      } else {
        const names = new Set(tables.map(t => t.name));
        if (!names.has('atomic_meta') || !names.has('atomic_rows') || [...names].some(n => !['atomic_meta', 'atomic_rows', ...sharedTableGroups.flat()].includes(n)) || sharedTableGroups.some(group => group.some(n => names.has(n)) && !group.every(n => names.has(n)))) throw new Error('Unknown atomic store schema');
        const rows = db.query('SELECT scope FROM atomic_meta').all() as { scope: string }[];
        if (rows.length !== 1 || rows[0]!.scope !== fixedScope) throw new Error('Atomic store scope mismatch');
      }
    }).immediate();
    db.run('PRAGMA journal_mode=WAL'); db.run('PRAGMA synchronous=FULL');
    // Retrying asynchronously lets another connection in this process finish its local awaits.
    db.run('PRAGMA busy_timeout=0');
  } catch (error) { db.close(); throw error; }
  let running = false, closed = false;
  return {
    async run<T>(work: (store: Store, database: SharedDatabase) => Promise<T> | T): Promise<T> {
      if (closed || running) throw new Error('Atomic store unavailable');
      running = true;
      let begun = false, active = false;
      const check = () => { if (!active) throw new Error('Atomic store scope ended'); };
      try {
        const deadline = performance.now() + lockTimeoutMs;
        while (true) {
          try { db.run('BEGIN IMMEDIATE'); begun = true; break; }
          catch (error) {
            if ((error as { code?: string }).code !== 'SQLITE_BUSY') throw error;
            if (performance.now() >= deadline) throw new Error('Atomic store lock timeout');
            await Bun.sleep(5);
          }
        }
        active = true;
        const seen = new Set<string>();
        class ScopedMap<V> extends Map<string, V> {
          constructor(private namespace: string, rows: { k: string; v: string }[]) {
            super();
            for (const row of rows) super.set(row.k, JSON.parse(row.v) as V);
          }
          override set(key: string, value: V): this {
            check();
            const encoded = JSON.stringify(value);
            if (typeof key !== 'string' || encoded === undefined) throw new Error('Invalid atomic store value');
            db.query('INSERT OR REPLACE INTO atomic_rows VALUES (?,?,?)').run(this.namespace, key, encoded);
            return super.set(key, value);
          }
          override delete(key: string): boolean {
            check(); db.query('DELETE FROM atomic_rows WHERE namespace=? AND k=?').run(this.namespace, key); return super.delete(key);
          }
          override clear(): void { check(); db.query('DELETE FROM atomic_rows WHERE namespace=?').run(this.namespace); super.clear(); }
        }
        const store: Store = {
          map<V>(namespace: string) {
            check();
            if (!/^[a-z][a-z0-9_]{0,63}$/.test(namespace) || seen.has(namespace)) throw new Error('Invalid or duplicate atomic map');
            seen.add(namespace);
            const rows = db.query('SELECT k,v FROM atomic_rows WHERE namespace=? ORDER BY rowid').all(namespace) as { k: string; v: string }[];
            return new ScopedMap<V>(namespace, rows);
          },
          close() { throw new Error('Atomic scope owns store lifetime'); },
        };
        const result = structuredClone(await work(store, sharedDatabase(db, pinnedScope, check)));
        active = false;
        db.run('COMMIT'); begun = false;
        return result;
      } catch (error) {
        active = false;
        if (begun) db.run('ROLLBACK');
        throw error;
      } finally { active = false; running = false; }
    },
    close() {
      if (running) throw new Error('Atomic work still running');
      if (!closed) { closed = true; db.close(); }
    },
  };
}
