# Operator migration command

Run `bun migration-command.ts <command> /secure/move-plan.json` from this directory. These are administrative commands against explicitly selected databases, not member operations. No command changes DNS, application routing, Vercel configuration or a provider.

Set `ATARASY_MIGRATION_SOURCE_URL` and, for destination operations, `ATARASY_MIGRATION_TARGET_URL` through the operator's secret environment. Mutating commands also require `ATARASY_MIGRATION_ARTIFACT_DIR` pointing to the approved isolated build. Connection strings are not command-line arguments. `DATABASE_URL` and application credentials are not used as fallbacks. The destination must be separately provisioned and migrated, with no existing deployment except an exact disabled candidate from an earlier attempt.

The plan is a regular JSON file, at most 64 KiB; symbolic links are refused. It contains exactly these fields:

| Field | Meaning |
|---|---|
| `identity` | Existing deployment `{id, environment, origin, epoch}` |
| `ticket` | Fresh UUID recorded before the first command; keep it for recovery |
| `runtimeFingerprint` | Fingerprint from the approved build’s runtime-manifest.json, recomputed from its files before every mutating command |
| `config` | Complete approved `MemberRuntimeConfig`, with no omitted or extra settings |

The command recomputes the configuration fingerprint and compares it with the source's persisted `member_config/current` record. Target configuration is also checked before activation. Mutating commands also recompute the artifact fingerprint from the API bundle, Vercel configuration, package metadata, ignore file and robots file. Unknown files and symlinks refuse. The artifact manifest binds deployment identity and configuration fingerprint. Inspect commands remain available without an artifact so a missing build does not prevent status recovery. This measures the selected local artifact, not the running remote binary; deployment orchestration must establish that evidence.

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

## Build identity

Run `bun deployment/build.ts /absolute/new-output-directory` from this package. The parent must exist and the output directory must not exist. The build refuses overwriting an earlier artifact, bundles the API and writes `runtime-manifest.json` with file sizes, SHA-256 digests, deployment identity, configuration fingerprint and a combined fingerprint. Record that combined value in the migration plan; keep the exact reviewed directory intact. A manifest is content-addressing metadata, not a publisher signature. Any rebuild needs a newly reviewed plan when its fingerprint changes.

## Rebinding a deployment's runtime profile

`http.ts`'s `binding()` refuses every request with `Bound runtime mismatch` once the running build's runtime profile or fingerprint disagrees with the `member_config/current` row a deployment was first bound under. #41 (2026-09-22) raised the profile from `atarasy.member-runtime.1` to `.2` by adding `androidAppOrigins`, and the deployed build answered 503 on every route for about a minute because nothing had moved the stored binding forward first. `migration-command.ts` cannot do this: `restore`/`activate` move a whole deployment between databases, and every one of its commands already refuses a source not bound to the *current* profile, so there was no path from `.1` to `.2` short of an operator hand-editing the row.

Use it when a config.ts change bumps the runtime profile (a new required field, a changed validation rule) and a live deployment must move to it without a database migration:

```bash
export ATARASY_MIGRATION_SOURCE_URL="postgres://user@host:port/an_isolated_database"
bun rebind-runtime.ts /secure/rebind-plan.json            # dry run: reports the transition, writes nothing
bun rebind-runtime.ts /secure/rebind-plan.json --write     # applies it
```

The plan is a regular JSON file, at most 64 KiB; symbolic links are refused. It contains exactly `identity` (the deployment's existing `{id, environment, origin, epoch}`) and `config` (the complete new `MemberRuntimeConfig`, validated the same way `http.ts` validates one on every start). The connection string comes only from `ATARASY_MIGRATION_SOURCE_URL`; a pooler host (`*-pooler*`) is refused, the same as `migrate.ts`, because the command needs the application's own consistent lock (`postgresStore(...).run(...)`), not a pooled connection.

The command refuses unless the source profile it finds bound is in an explicit allow-list. It has two entries: `atarasy.member-runtime.1` to `.2`, permitted to add exactly `androidAppOrigins: []`, and, since 2026-09-23, `.2` to `.3`, permitted to add exactly `invitationLifetimeMs: 1209600000`. A plan's configuration is always read as the current profile, so only the entry that ends at it can be applied; a deployment still bound to `.1` is refused. Every other configuration key must already be identical between the bound row and the plan's `config`; a plan that also changes, say, `explorationRate` is refused rather than silently carrying the second change through. Extending the list to a future profile bump is a code change to `rebind-runtime.ts`, reviewed like any other widening of what an operator command is allowed to do; it never grows to permit an unlisted field or a downgrade. If the deployment is already bound to the plan's exact profile and configuration, the command is a no-op that reports `already bound`.

Always run the dry run first and read `differing` before passing `--write`. Take a Neon backup branch of the target database before writing, the same discipline as any other operator command against a live deployment (`OPERATIONAL_SNAPSHOT.md`). Once `--write` succeeds, **promote the new build immediately**: the old build's own `binding()` check now refuses every request against the rebound row (it still expects the old profile), so the window between rebinding and promoting is exactly the outage #41 produced, and rebinding first only means the *next* deploy fixes it rather than every deploy after a rebuild.

The command prints one small JSON summary (`deployment`, `from`, `to`, `action`, `differing`) on success and a fixed, generic message on any refusal; it never prints a connection string, a member row or a driver error, and it always closes its own pool. Tests exercise it against a synthetic deployment and the executable CLI as a subprocess, including redaction of connection failures. No hosted database is part of that test.

