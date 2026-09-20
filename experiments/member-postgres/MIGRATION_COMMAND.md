# Operator migration command

Run `bun migration-command.ts <command> /secure/move-plan.json` from this directory. These are administrative commands against explicitly selected databases, not member operations. No command changes DNS, application routing, Vercel configuration or a provider.

Set `ATARASY_MIGRATION_SOURCE_URL` and, for destination operations, `ATARASY_MIGRATION_TARGET_URL` through the operator's secret environment. Connection strings are not command-line arguments. `DATABASE_URL` and application credentials are not used as fallbacks. The destination must be separately provisioned and migrated, with no existing deployment except an exact disabled candidate from an earlier attempt.

The plan is a regular JSON file, at most 64 KiB; symbolic links are refused. It contains exactly these fields:

| Field | Meaning |
|---|---|
| `identity` | Existing deployment `{id, environment, origin, epoch}` |
| `ticket` | Fresh UUID recorded before the first command; keep it for recovery |
| `runtimeFingerprint` | SHA-256 fingerprint of the approved runtime, supplied by trusted orchestration |
| `config` | Complete approved `MemberRuntimeConfig`, with no omitted or extra settings |

The command recomputes the configuration fingerprint and compares it with the source's persisted `member_config/current` record. Target configuration is also checked before activation. This does not independently measure the deployed binary or attest the supplied runtime fingerprint; deployment orchestration must establish that evidence.

| Command | Action |
|---|---|
| `inspect-source` | Report enabled state, migration phase and snapshot digest without changing data |
| `inspect-target` | Inspect the existing destination deployment in the same way |
| `freeze` | Atomically stop source writes and record the ticket/final state |
| `restore` | Transfer the same frozen ticket in memory to a disabled destination; refuse an enabled source |
| `activate` | Bind and retire the source before enabling its single target |
| `abort` | Resume a still-frozen source and invalidate the ticket; refuse candidates and retired sources |

A typical sequence is `inspect-source`, `freeze`, `restore`, `inspect-target`, `activate`, then inspect both. Routing changes occur only through separately approved deployment orchestration. A request still routed to the retired source is fenced, not automatically forwarded.

Commands do not print snapshots, member rows, tokens, connection strings or driver errors. Success emits a small JSON summary. Failure exits with status 1 and a fixed message directing the operator to inspect both sides before retrying. A failed command is not evidence that its database commit did not happen. The same plan and ticket recover freeze, restoration and activation; no destructive overwrite or automatic source re-enable occurs. A restore retry accepts only the exact disabled candidate, with valid locally generated identity, matching original rows and schema. It refuses an already active or changed destination.

Snapshots are transferred only in this trusted process's memory between the two database connections. This command intentionally does not create a plaintext backup file. Connection security and access to the environment/process remain operator responsibilities. Persistent encrypted backup transport and deployed routing/health acceptance are separate work.

See [the migration lifecycle](OPERATIONAL_SNAPSHOT.md) for candidate identity, aborted-ticket history, repeated moves and compatibility limits. Tests exercise commands with synthetic PostgreSQL deployments and the executable CLI as a subprocess, including redaction of connection failures. No hosted database is part of that test.
