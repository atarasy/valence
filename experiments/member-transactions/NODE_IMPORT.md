# Validated node archive import and rehearsal

## Import boundary

`validateNodeImport` clones and validates the exact current `valence-node/4` shape, including every required nested record field. JSON size, array sizes, identifiers, enums, safe integers, nullability, and finite numbers are bounded. Unknown fields and non-JSON values are refused. Checks cover destination household, duplicate identifiers, candidate ownership, mandate references, notes, confirmation references, lineage scope, collection candidates/valences, physical delivery references, permission shape/lifetime and settlement line identities/arithmetic/payer. Physical consumed settlements require their stored confirmation. This is an archive profile; incomplete older exports are rejected rather than silently filled.

The internal local HTTP wrapper runs schema checks before locking and destination catalogue/disclosure/lineage-signature checks inside the unit against already trusted keys. The existing import sequence then runs atomically; conflicts still roll back its successful prefix. The reference server is unchanged. Shape and signature checks do not authenticate the export's sender or prove historical attestation, old mandate authority, or an omitted record's nonexistence. Do not mount reference import routes as a member API.

## Rehearsal

`rehearseNodeImport(sourcePath, newDirectory, household, policy, at)` opens the unified source database read-only, checks its environment/audience scope and reads engine rows in one consistent snapshot. Engine export and expiry handling occur on cloned in-memory rows. Source content is not rewritten. Frozen catalogue terms and disclosure signatures are checked against source dependencies before creating the destination.

The destination directory must not exist. Only public identity/endorsement/catalogue/disclosure dependencies and the selected validated household export are copied. Actual reference import handlers run within the atomic local composition, then a fresh engine re-exports at the same declared time. A canonical digest includes every export field except `exported_at`; equality is required before returning verified success.

A durable `archive_rehearsal_meta` marker makes ordinary atomic-store opening fail its unknown-schema check. Both successful and failed rehearsals are marked, so even a partial archive cannot be accidentally opened as a normal member store. Failed directories remain for inspection and cannot be overwritten by retry. The source and any pre-existing destination remain unchanged.

## What this does not migrate

Node export omits member credentials/sessions, ownership/binding records, operation and review journals, ledger reservations and daily reports, contextual settlement proof identities, some pending actions and deployment configuration. Equal exports are not equal operational databases. The result explicitly reports `archive-only` and `operationalCutover: false`; no server is switched to it.

The migration source is the current unified local schema. Separate legacy engine/login/authority files require their own versioned importer. Historical attestation and recovered authority depend on trusted source provenance, not on an archive boolean. Noncanonical household route encodings or reference-format inconsistencies may fail round-trip and remain incomplete archives; no successful cutover is inferred from a partially populated file.

Next define a complete operational snapshot contract, inventory every engine and member namespace/table, include dependencies and replay/counter state, reject unknown versions and conflicting scopes, and test a new-file migration with export and behavioural equivalence. Only after that contract and request-authority tests should a restricted member API and Swift signing be enabled.

## Evidence limits

Tests use generated local fixture files, real engine export/import and cryptographic checks, and an actual local settlement receipt. They verify logical source rows remain equal, overwrite refusal, schema/relation failures, archive opening refusal and failed-import isolation. They are not migration of a user's live file, historical source attestation verification, network transport, native device or new process-kill evidence. Existing regression suites retain their previous scope.

## Subsequent complete persisted snapshot

[Operational snapshot v1](OPERATIONAL_SNAPSHOT.md) copies the complete current unified persisted schema, including member authentication and operation/ledger state that node archives omit. This is a separate profile; the archive marker remains protective. A writer fence and explicit single-writer cutover are still required.
