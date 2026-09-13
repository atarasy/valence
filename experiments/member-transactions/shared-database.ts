import { Database } from 'bun:sqlite';
type Scope = { environment: string; audience: string };
export type SharedDatabase = Readonly<{ scope: Readonly<Scope> }>;
export type DatabaseTarget = string | SharedDatabase;
const capabilities = new WeakMap<SharedDatabase, Database>();
const participants = new WeakMap<object, DatabaseTarget>();
export const sharedTableGroups = [
  ['authority_meta', 'credentials', 'ownership', 'principals', 'sessions'],
  ['challenges', 'login_meta', 'passkeys'],
  ['binding_meta', 'bindings'],
  ['operation_meta', 'operations'],
];
/** Internal factory owned by the outer local transaction. No raw connection escapes. */
export function sharedDatabase(db: Database, scope: Scope, check: () => void): SharedDatabase {
  const capability = Object.freeze({ scope: Object.freeze({ ...scope }) });
  const guarded = new Proxy(db, { get(_target, property) {
    if (property === 'close') return () => { check(); };
    if (property === 'run') return (...args: Parameters<Database['run']>) => { check(); return db.run(...args); };
    if (property === 'query') return (...args: Parameters<Database['query']>) => {
      check(); const statement = db.query(...args);
      return new Proxy(statement, { get(target, key) {
        if (!['get', 'all', 'run'].includes(String(key))) throw new Error('Unsupported scoped statement access');
        return (...values: unknown[]) => { check(); return Reflect.apply(Reflect.get(target, key), target, values); };
      } });
    };
    if (property === 'transaction') return (fn: (...args: any[]) => any) => {
      check(); const transaction = db.transaction(fn);
      const wrap = (call: (...args: any[]) => any) => (...args: any[]) => { check(); return call(...args); };
      return Object.assign(wrap(transaction), { immediate: wrap(transaction.immediate), deferred: wrap(transaction.deferred), exclusive: wrap(transaction.exclusive) });
    };
    throw new Error('Unsupported scoped database access');
  } });
  capabilities.set(capability, guarded); return capability;
}
export function databaseFor(target: DatabaseTarget, scope: Scope) {
  if (typeof target === 'string') return { db: new Database(target, { create: true, strict: true }), shared: false };
  const db = capabilities.get(target);
  if (!db || target.scope.environment !== scope.environment || target.scope.audience !== scope.audience) throw new Error('Shared database scope mismatch');
  return { db, shared: true };
}
export function registerParticipant<T extends object>(target: DatabaseTarget, value: T): T { participants.set(value, target); return value; }
export function assertParticipants(target: DatabaseTarget, ...values: object[]) {
  if (values.some(value => typeof target === 'string' ? typeof participants.get(value) === 'object' : participants.get(value) !== target)) throw new Error('Mixed shared database participants');
}
