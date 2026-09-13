# PostgreSQL transaction foundation

First implementation stage of Vault decision 58, following the confirmed Vercel plus Neon selection. This package implements ordered engine persistence, immutable deployment identity and a database-enforced writer lock. Decision 59 now adds the member HTTP runtime: authority, login, enrolment, bindings, operation journal and prepared reviews use scoped record namespaces in this PostgreSQL store. No SQLite database is opened by a hosted request. The SQLite implementation remains an independent regression baseline.

## Run

Install the pinned dependencies with `bun install --frozen-lockfile`. Generate migrations with `bun run generate`. Run `DATABASE_URL_UNPOOLED=... bun migrate.ts` against a dedicated development database using a direct connection. Provisioning identity is an explicit trusted call to `initialiseDeployment`, separate from HTTP and migration execution. Application traffic can use a pooled URL. Neither migration nor bootstrap runs at module import.

For tests, set `ATARASY_TEST_POSTGRES_URL` to an isolated PostgreSQL database and run `bun test store.test.ts --timeout 30000`. Tests apply tracked migrations and create/remove their own uniquely named deployment rows. They never read DATABASE_URL. Do not point the test URL at a production database. Test fixtures use synthetic identities, signatures and a copied local engine fixture; no member credentials are imported from a live account.

## Behaviour and limits

Every unit checks out one pg connection, begins a transaction and locks the deployment control row with FOR UPDATE before loading state. Scope, enabled state and writer epoch must match. All writers sharing that deployment row are serialised, including separate offers sharing a daily ceiling. The engine operates on synchronous in-memory maps loaded under the lock; explicit set/delete/clear calls stage ordered writes for the same transaction. Values are serialised at set time. A later object mutation without set is not persisted. Existing keys retain order; delete and reinsert moves a key to the end.

Results must be structured-cloneable. Captured map methods and iterators cannot operate after the callback ends. Exceptions, invalid output, database errors and payload-limit failures roll back. No callback or uncertain commit is retried automatically. The pool retains TLS verification defaults. Production integration must install an idle-pool error handler and Vercel pool lifecycle integration before serving requests.

The initial foundation permits at most 10,000 engine rows, 16 MiB encoded state, 1 MiB per value and 10,000 staged writes per transaction. The snapshot is loaded in full and all work for one deployment is serialised. This is a development baseline, not an established capacity claim. Lock/statement limits are 5 seconds and idle-transaction timeout is 10 seconds; callbacks must only perform bounded local work and must not dispatch external effects. Administrative direct SQL is outside the writer fencing guarantee.

## Member persistence composition

| Existing component | Required PostgreSQL replacement |
|---|---|
| Atomic engine Store | Implemented here; preserve engine canonical bytes and map semantics |
| Member authority | Scoped principal, credential/session revocation and ownership records under the same lock |
| Verified login | Library verification, durable challenge consumption and credential counter/revision checks |
| Enrolment | Invitation and handle records; consumed failed ceremony with staged activation savepoint rollback |
| Mandate bindings | Immutable credential-to-mandate association and current authority checks |
| Operation journal/reviews | Unique operation claims, exact request/review identity and durable outcome reconciliation |
| HTTP admission | Shared database counters plus bounded per-process pending requests; Vercel-controlled peer header |
| Local snapshots/cutover | PostgreSQL-specific import, writer activation and rollback rehearsal; no file-copy substitution |

## Measured boundary

Six real local PostgreSQL integration tests pass: actual engine settlement survives a fresh pool; competing offers respect one daily allowance; a post-settlement exception rolls back; set-time bytes/order/capability lifetime are preserved; stale or disabled writers are refused; and a competing callback waits for the control lock. Removing FOR UPDATE in an isolated copy makes the lock test fail at the early-entry assertion. This is not Neon cloud, Vercel deployment or native-device evidence.

Use Vercel project `voxtech/atarasy-api-dev`, created for this development service, then add Neon through that project's Storage/Marketplace connection. Do not attach one of the five unrelated databases in Vercel: Vox. The API origin remains https://api-dev.vox.delivery. No public API has been deployed yet.

The same six tests subsequently passed on the dedicated Neon branch dev-postgres-foundation-20260913 (br-soft-sound-b3i9xnjm) in project young-pond-73223516, with 20 assertions. The first remote run exceeded Bun's default five-second test timeout in three multi-step fixtures; the rerun used a 30-second test timeout without changing database lock or statement deadlines. Neon connections explicitly use sslmode=verify-full. The default branch was not migrated. This extends database evidence to Neon, not to the unimplemented member API or Vercel runtime.

## Development HTTP deployment

The public surface remains the six auth routes, scoped member reads and statement-operation routes. Configuration in deployment/config.json pins api-dev.vox.delivery, development environment and RP ID, a five-minute ceremony/operation lifetime, a one-hour session lifetime and 60 requests per peer per minute. Exploration rate 0.2, one reminder and three recovery grace days are explicit development defaults, not a production commercial policy. The dedicated development project uses the Vercel production environment slot.

Run deployment/build.ts with an explicit isolated output directory to bundle the API and write its Vercel configuration. Vercel uses Bun 1.x, Singapore and a 60-second function limit. The entry integrates the pg pool lifecycle, rejects other origins, takes the trusted peer from x-vercel-forwarded-for, and keeps generic errors free of connection details. Documented ingress behaviour: https://vercel.com/docs/headers/request-headers. Requests bypassing Vercel are not supported by this entry. The schema/bootstrap command is separate from the deployed bundle and verifies the exact dedicated Neon project ID.

AASA currently responds 503 association_pending_signed_app_verification. The candidate JSON remains in the iOS repository; only enable it after comparing the signed application's identifier and Associated Domains entitlement. No real member principal, invitation, credential or mandate is provisioned by deployment. API availability does not constitute a successful native ceremony.

Member record references are validated in application code under one PostgreSQL deployment lock. They are not relational foreign keys. The primary key prevents duplicate record identities; a PostgreSQL partial unique index additionally prevents two blocking operations for one offer. Staged savepoints restore both map state and write buffers synchronously. The removed-savepoint negative control leaves a passkey after failed activation and is caught by the public registration test.

Local verification now covers 13 tests and 54 assertions. Neon first ran the original 11 tests (48 assertions); two additional tests cover database-enforced operation uniqueness and expired/wrong-challenge assertions. Keep the separate run logs rather than implying one larger cloud run. Native signing, actual member provisioning, workload capacity and a populated-database rollback rehearsal remain separate acceptance work.
