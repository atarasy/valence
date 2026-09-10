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

class WriteThroughMap<T> extends Map<string, T> {
  constructor(
    private readonly db: Database,
    private readonly table: string,
    rows: Iterable<readonly [string, T]>
  ) {
    // Empty, and loaded below. `Map`'s constructor calls `set` for each entry
    // it is given, and `set` here reaches `this.db`, which the field
    // initialisers have not assigned yet when the constructor runs.
    super();
    for (const [k, v] of rows) super.set(k, v);
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

/** A store that keeps nothing. What the suites run against. */
export function inMemoryStore(): Store {
  return {
    map<T>(): Map<string, T> {
      return new Map<string, T>();
    },
    close() {},
  };
}

/** A store on disk. `path` may be a file or `:memory:` for a database that is not one. */
export function openStore(path: string): Store {
  const db = new Database(path, { create: true });
  // Durability over speed: a settlement that returned and then vanished is
  // worse than a settlement that took a millisecond longer.
  db.run("pragma journal_mode = wal");
  db.run("pragma synchronous = full");
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
      db.close();
    },
  };
}
