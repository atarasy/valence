# PostgreSQL operational migration

These trusted administrative APIs operate on one deployment under its application writer lock. They are not HTTP member routes. The deployment identifier, environment, HTTPS origin and epoch must remain identical: this is same-origin infrastructure migration, not cross-origin passkey portability.

## Capture and restore

`captureDeployment(pool, identity)` returns every ordered namespace/key/raw JSON value. That includes engine facts, carriage quotations, fixed protections, original confirmations, operation and review history, incarnation heads, credentials, passkey counters and sessions. Capture alone does not disable the source, so a live snapshot can become stale.

`restoreDeploymentCandidate(pool, snapshot, identity)` requires an absent destination deployment and matching tables, columns, constraints and indexes. Extra tables or non-internal triggers refuse. It writes all original rows in one transaction, preserving relative insertion order, then reads them back before commit. Destination ordinals are generated locally. The destination control is always disabled.

For a frozen snapshot, restoration also creates a new local target-instance record. This explicitly marks the copy as a candidate from the moment it exists, so it cannot invoke source abort. Generic restoration refuses snapshots already carrying a target instance: a fresh migration lifecycle must archive it first. Application rows retain their exact stored bytes; migration metadata is the documented addition.

Snapshots contain sensitive household and authentication records and must be handled as database backups. Their digest detects accidental changes, not provenance. No contents are logged or written to files by these APIs. Only trusted source snapshots may be used; schema equality is not proof that arbitrary supplied application records are valid.

## Freeze and activate

`freezeDeployment(pool, identity, ticket, runtimeFingerprint)` atomically records the caller-supplied UUID ticket, disables source writes and captures final state. The runtime SHA-256 fingerprint is retained and checked. The operator CLI now recomputes it from a reviewed local build; these database functions do not independently measure or attest the running binary. A matching retry verifies schema and pre-freeze content and returns the same final snapshot. Competing tickets refuse. Failure before commit rolls back the ticket and disable. Normal writers and bootstrap refuse a disabled source.

`activateDeploymentCandidate(sourcePool, targetPool, identity, ticket, runtimeFingerprint)` holds the source lock, validates the disabled target and its local instance, and commits source retirement bound to that exact instance. Only then does it atomically record target activation and enable the target. The source stays disabled. A second independently restored candidate has another instance and cannot activate that retired ticket.

Exact retry handles interruption after either database commit, including lost acknowledgements. Once active, target application data may advance; retries check the immutable activation receipt rather than the former application-content hash. Failed transitions may leave both hosts disabled, but never enable both through these APIs. Administrative direct SQL and external database cloning are outside this guarantee.

## Abort and subsequent migration

`abortDeploymentMigration(pool, identity, ticket, runtimeFingerprint)` acts only on a still-frozen source. It refuses restored candidates, retired sources, wrong tickets and changed frozen data. Under the same source lock as activation it records permanent aborted-ticket history, removes the current freeze and enables the source in one transaction. Thus abort and activation cannot both succeed. A matching abort retry reads its historical acknowledgement and does not change current writer state. Reusing an aborted ticket for another freeze is refused, and every candidate copied under it remains unable to activate.

An active migrated host can freeze under a fresh ticket. The previous arrival and target-instance records are archived in `member_writer_history`, and the new freeze includes all subsequent application writes and that history. The next restore mints a new destination identity. No old target-instance record is cloned. Previous tickets cannot be recycled or used to activate an old source again. Returning to former infrastructure requires a new empty destination database; overwriting a retired database with older state is not a rollback strategy.

The source-freeze profile is `atarasy.postgres-writer-freeze.2`. Earlier experimental profile-1 frozen records lack the candidate/source distinction required for abort and are refused by this lifecycle. No deployed profile-1 migration is claimed. Such records need a separate explicit recovery assessment; the implementation does not guess their role.

## Verification and remaining work

Synthetic PostgreSQL tests cover ordered copies, writer barriers, scope/schema/digest refusal, mid-write rollback, competing targets, retire-before-enable, lost commit acknowledgements, abort/activation races, copied-candidate abort refusal, ticket reuse refusal and two successive moves preserving newer data and migration history. Actual HTTP tests carry committed digital decision and withdrawal outcomes, prepared successor reviews, quotations, incarnation and passkey counters through implemented freeze and activation. Old counters refuse; the next valid assertion succeeds.

Operator orchestration, sensitive backup transport/storage, deployment runtime attestation, routing and deployed acceptance remain outstanding. Native host switching and cross-origin identity migration are separate requirements. These APIs do not contact a payment provider or update routing. The older SQLite snapshot implementation remains separate and has its own coverage limitations.
