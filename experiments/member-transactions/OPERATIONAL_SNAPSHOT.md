# Operational snapshot v1

## Supported input

This is an exact copy of the complete current unified persisted database, not a conversion of legacy split files. `operational-schema-v1.json` pins every table/index definition captured from the current constructors using generated fixtures; it contains DDL only, no fixture credentials. All 16 tables must exist. Unknown tables, triggers, indexes, changed constraints or partial module groups are refused. A new version requires an explicit schema change, not a permissive fallback.

| Persisted group | Contents copied |
|---|---|
| Atomic store | Scope and every recognised namespace row |
| Authority | Principals, credentials, ownership, session digests, expiry and revocation |
| Login | Public-key BLOBs, counter/revision, active flag, user handles and pending challenges |
| Binding | Principal/credential/household/mandate key fingerprints |
| Operations | Full records in every state, including cancelled, dispatching and uncertain |
| Reviews | Frozen snapshots, contextual challenges and accepted assertion fingerprints |

The engine namespace inventory includes offers, candidate notes, bare receipts, settlements and contextual proof identities; catalogues, public keys, endorsements and disclosures; decision confirmations and lineage; reservations, mandates, collections and household daily/offer copies; delivery, permissions/actions/queries, recovery channels/recoverers/logs, deliberations and registry entries/keys. Copying all rows preserves absent/present distinctions and BLOB bytes. Nothing is renewed, re-signed, re-provisioned or reset.

## Candidate construction

`createOperationalSnapshot(sourcePath, newDirectory, scope)` opens the source read-only and reads schema, integrity/foreign-key checks and all rows in a single SQLite read transaction. It checks exact scopes, known JSON namespaces, key/counter bounds, authority/binding references, unambiguous candidate IDs, active ownership, operation digests, committed receipt/reservation relationships and frozen-review digests. It does not attempt to repair invalid source records or reinterpret historical authority.

A new exclusive directory uses mode 0700 and its new SQLite file uses mode 0600. Pinned DDL and all records are copied in one destination transaction with foreign keys and FULL synchronous mode. Exact logical equality, including BLOB bytes and all row values, is required before commit. The report contains profile, scope, digest, table counts and verified/cutover flags, not row values or bearer credentials. Failed work leaves an unverified candidate report for inspection; it is never selected for use.

The returned destination is operationally readable for verification with the same application/runtime configuration. Unlike the archive-only profile it is not deliberately blocked by an archive marker. `cutover` remains false. No listener, environment variable, live path or source row is changed.

## Verification and limits

Tests prove a prepared assertion can settle on the copied database, committed contextual replay returns the same receipt without a second daily entry, an already verified proof and pending login challenge retain shared counter semantics, revoked credentials stay revoked and uncertain operations stay uncertain. They check logical source equality, exact target equality, permission modes, overwrite refusal, bad scopes, extra triggers/namespaces and corrupt request digests. A source write after snapshot changes the next digest and does not update the old candidate.

This is fixture-based current-schema migration evidence, not production cutover or a new crash/parallel-process measurement. Structural and critical reference validation does not prove every historic record is authentic. The source must be trusted. Deployment configuration, RP/origin, day/time-zone policy, external credentials and remote provider state are outside SQLite and must be matched separately. Remote ledgers cannot be migrated by copying local reservation records.

## Next gate: one active writer

A running source may advance immediately after the read snapshot. The candidate must never be treated as current merely because its copy passed. Next implement a persistent writer fence understood by every supported composition, drain admitted work, create the final snapshot under that fence, compare the final digest and runtime configuration, and activate exactly one destination. Source retirement must persist across restart. A failed cutover must not leave two active writers or silently discard writes accepted after the original snapshot. Define rollback and explicit operator activation before adding the restricted member HTTP surface and Swift signing.

## Subsequent durable cutover

[Local writer cutover](LOCAL_CUTOVER.md) adds per-unit scope rechecking, durable freeze/retirement, fenced snapshot copying and exact-target activation with a persistent receipt. Table DDL remains unchanged; `writer_activation` is now a recognised namespace. Full deployment adoption and actual runtime fingerprint/path integration remain separate from fixture cutover tests.
