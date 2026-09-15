import { Database } from "bun:sqlite";

/**
 * §13.2, and `15` §5 of the concept documents. Where a deployment keeps what it
 * holds, so that a restart is not a loss.
 *
 * **A store is a `Map` that writes through.** Every register in this engine
 * keeps its rows in a `Map` and reads them synchronously, and making those
 * reads asynchronous to reach a database would push `await` through code whose
 * shape is the state machine of §2.1. So the rows stay in memory, they are
 * loaded once at start, and every write is mirrored to disk before it returns.
 *
 * **The engine has no dependencies and this adds none**: `bun:sqlite` is part
 * of the runtime. That matters because `15` says the engine has none, and a
 * property claimed in a document is one to keep rather than to qualify.
 *
 * **Unset means in memory**, which is what the conformance suites run against
 * and what the reference has always done. A deployment that wants to survive a
 * restart says where.
 */
export type Store = {
  /** A map whose writes reach the disk, or an ordinary one when there is no disk. */
  map<T>(table: string): Map<string, T>;
  close(): void;
};

/**
 * §14.2, §13.2, question 53. What undoes the writes of the atomic block in
 * progress, most recent first, or nothing when no block is open.
 *
 * Module-wide rather than per store, because the registers a route writes are
 * not always one store's: the reference process opens one, and the suites and
 * unit tests hand each register its own. A block covers every map any store
 * handed out.
 */
let journal: (() => void)[] | null = null;
const openDatabases = new Set<Database>();

/**
 * A map whose writes can be taken back while an atomic block is open. Rows
 * are replaced whole by `set`, so the value a write displaces is the value to
 * put back; a caller that mutates a row it read and then sets it has already
 * changed the displaced value, which is why the engine's import writes copy.
 */
class JournalMap<T> extends Map<string, T> {
  override set(key: string, value: T): this {
    if (journal) {
      const had = super.has(key);
      const before = super.get(key);
      journal.push(() => (had ? super.set(key, before as T) : super.delete(key)));
    }
    return super.set(key, value);
  }

  override delete(key: string): boolean {
    if (journal && super.has(key)) {
      const before = super.get(key) as T;
      journal.push(() => super.set(key, before));
    }
    return super.delete(key);
  }

  override clear(): void {
    if (journal) {
      const before = [...super.entries()];
      journal.push(() => {
        super.clear();
        for (const [k, v] of before) super.set(k, v);
      });
    }
    super.clear();
  }
}

/**
 * §14.2, question 53. Run `fn` so that either every write it makes stands or
 * none does, in memory and on disk. A refused import already wrote nothing
 * (question 51), and an accepted one was written a statement at a time, so a
 * locked database, a full disk or a process killed partway left a move half
 * written with its offers held and its collections and mandates lost.
 *
 * `fn` must be synchronous: a block that awaited would let another request
 * write inside it, and the check for a promise runs only after `fn` returns,
 * so writes after an `await` would land outside the block. Blocks do not nest.
 *
 * **Across two databases the commit is two commits.** The reference opens one
 * store; a deployment that opens two can have the second commit fail after the
 * first succeeded, and memory is then put back while the first database keeps
 * its rows. The block also takes a write lock on every database the process
 * holds, not only those the block writes, which is why each waits on a busy
 * database rather than failing at once.
 */
export function atomically<R>(fn: () => R): R {
  if (journal) throw new Error("store: an atomic block is already open");
  const dbs = [...openDatabases];
  journal = [];
  const undo = journal;
  try {
    for (const db of dbs) db.run("BEGIN IMMEDIATE");
    const result = fn();
    if (result instanceof Promise) throw new Error("store: an atomic block must be synchronous");
    for (const db of dbs) db.run("COMMIT");
    return result;
  } catch (error) {
    for (const db of dbs) {
      try {
        db.run("ROLLBACK");
      } catch {
        // No transaction open on this one, because BEGIN is what failed.
      }
    }
    for (const step of undo.reverse()) step();
    throw error;
  } finally {
    journal = null;
  }
}

class WriteThroughMap<T> extends JournalMap<T> {
  constructor(
    private readonly db: Database,
    private readonly table: string,
    rows: Iterable<readonly [string, T]>
  ) {
    // Empty, and loaded below. `Map`'s constructor calls `set` for each entry
    // it is given, and `set` here reaches `this.db`, which the field
    // initialisers have not assigned yet when the constructor runs.
    super();
    // Loaded past the journal: these rows are already on disk, and a block that
    // rolled back must not take them out of memory.
    for (const [k, v] of rows) Map.prototype.set.call(this, k, v);
  }

  override set(key: string, value: T): this {
    super.set(key, value);
    this.db
      .query(`insert or replace into "${this.table}" (k, v) values (?, ?)`)
      .run(key, JSON.stringify(value));
    return this;
  }

  override delete(key: string): boolean {
    const had = super.delete(key);
    this.db.query(`delete from "${this.table}" where k = ?`).run(key);
    return had;
  }

  override clear(): void {
    super.clear();
    this.db.query(`delete from "${this.table}"`).run();
  }
}

/**
 * A map kept only in memory whose writes an atomic block can take back. For
 * indexes derived from a store's rows, which have to roll back with them.
 */
export function transientMap<T>(): Map<string, T> {
  return new JournalMap<T>();
}

/** A store that keeps nothing. What the suites run against. */
export function inMemoryStore(): Store {
  return {
    map<T>(): Map<string, T> {
      return new JournalMap<T>();
    },
    close() {},
  };
}

/** A store on disk. `path` may be a file or `:memory:` for a database that is not one. */
export function openStore(path: string): Store {
  const db = new Database(path, { create: true });
  openDatabases.add(db);
  // Durability over speed: a settlement that returned and then vanished is
  // worse than a settlement that took a millisecond longer.
  db.run("pragma journal_mode = wal");
  db.run("pragma synchronous = full");
  // An atomic block opens a transaction on every database the process holds,
  // so a writer holding another one briefly should make it wait rather than
  // fail the import (question 53).
  db.run("pragma busy_timeout = 5000");
  const seen = new Set<string>();
  return {
    map<T>(table: string): Map<string, T> {
      if (seen.has(table)) {
        throw new Error(`store: ${table} was opened twice, and two maps over one table diverge`);
      }
      seen.add(table);
      db.run(`create table if not exists "${table}" (k text primary key, v text not null)`);
      const rows = db
        .query(`select k, v from "${table}"`)
        .all() as { k: string; v: string }[];
      return new WriteThroughMap<T>(
        db,
        table,
        rows.map((r) => [r.k, JSON.parse(r.v) as T] as const)
      );
    },
    close() {
      openDatabases.delete(db);
      db.close();
    },
  };
}
