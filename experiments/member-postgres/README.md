# PostgreSQL transaction foundation

First implementation stage of Vault decision 58, following the confirmed Vercel plus Neon selection. This package implements ordered engine persistence, immutable deployment identity and a database-enforced writer lock. It is not yet the member API: authority, login, enrolment, bindings and the operation journal still use the local SQLite implementation.

## Run

Install the pinned dependencies with `bun install --frozen-lockfile`. Generate migrations with `bun run generate`. Run `DATABASE_URL_UNPOOLED=... bun migrate.ts` against a dedicated development database using a direct connection. Provisioning identity is an explicit trusted call to `initialiseDeployment`, separate from HTTP and migration execution. Application traffic can use a pooled URL. Neither migration nor bootstrap runs at module import.

For tests, set `ATARASY_TEST_POSTGRES_URL` to an isolated PostgreSQL database and run `bun test store.test.ts`. Tests apply tracked migrations and create/remove their own uniquely named deployment rows. They never read DATABASE_URL. Do not point the test URL at a production database. Test fixtures use synthetic identities, signatures and a copied local engine fixture; no member credentials are imported from a live account.

## Behaviour and limits

Every unit checks out one pg connection, begins a transaction and locks the deployment control row with FOR UPDATE before loading state. Scope, enabled state and writer epoch must match. All writers sharing that deployment row are serialised, including separate offers sharing a daily ceiling. The engine operates on synchronous in-memory maps loaded under the lock; explicit set/delete/clear calls stage ordered writes for the same transaction. Values are serialised at set time. A later object mutation without set is not persisted. Existing keys retain order; delete and reinsert moves a key to the end.

Results must be structured-cloneable. Captured map methods and iterators cannot operate after the callback ends. Exceptions, invalid output, database errors and payload-limit failures roll back. No callback or uncertain commit is retried automatically. The pool retains TLS verification defaults. Production integration must install an idle-pool error handler and Vercel pool lifecycle integration before serving requests.

The initial foundation permits at most 10,000 engine rows, 16 MiB encoded state, 1 MiB per value and 10,000 staged writes per transaction. The snapshot is loaded in full and all work for one deployment is serialised. This is a development baseline, not an established capacity claim. Lock/statement limits are 5 seconds and idle-transaction timeout is 10 seconds; callbacks must only perform bounded local work and must not dispatch external effects. Administrative direct SQL is outside the writer fencing guarantee.

## Persistence inventory for the next stage

| Existing component | Required PostgreSQL replacement |
|---|---|
| Atomic engine Store | Implemented here; preserve engine canonical bytes and map semantics |
| Member authority | Async principals, credential/session revocation and ownership queries on the same transaction connection |
| Verified login | Challenge consumption and credential counter/revision recheck; no automatic ceremony retry |
| Enrolment | Invitation and handle persistence; consumed failed ceremony with credential activation inside a savepoint |
| Mandate bindings | Immutable credential-to-mandate association and current authority checks |
| Operation journal/reviews | Unique operation claims, exact request/review identity and durable outcome reconciliation |
| HTTP admission | Shared bounded admission across Vercel instances, with trusted peer attribution |
| Local snapshots/cutover | PostgreSQL-specific import, writer activation and rollback rehearsal; no file-copy substitution |

## Measured boundary

Six real local PostgreSQL integration tests pass: actual engine settlement survives a fresh pool; competing offers respect one daily allowance; a post-settlement exception rolls back; set-time bytes/order/capability lifetime are preserved; stale or disabled writers are refused; and a competing callback waits for the control lock. Removing FOR UPDATE in an isolated copy makes the lock test fail at the early-entry assertion. This is not Neon cloud, Vercel deployment or native-device evidence.

Use Vercel project `voxtech/atarasy-api-dev`, created for this development service, then add Neon through that project's Storage/Marketplace connection. Do not attach one of the five unrelated databases in Vercel: Vox. The API origin remains https://api-dev.vox.delivery. No public API has been deployed yet.
