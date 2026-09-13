# Durable local writer cutover

## State and ordering

The active atomic scope is unchanged. A fence replaces that scope row with `atarasy.local-writer-fence.1`: original scope, ticket, canonical source/target paths, supplied runtime fingerprint, content digest and frozen/retired phase. Updated atomic units check the exact active scope after BEGIN IMMEDIATE, before invoking any work. A connection opened before fencing is therefore blocked on its next unit, as are new opens. GET routes that may persist expiry are also blocked.

`prepareLocalCutover` waits for the database lock, validates the complete source, records the final digest and fence, then copies to an exclusive destination with the fence intact. Work that committed before the fence is included. Work still queued after it is refused. A pre-existing destination is refused before fencing. A subsequent copy failure leaves the source stopped; there is no automatic unfreeze.

`resumeLocalCutoverPreparation` verifies the frozen ticket/runtime/source digest. It can create a copy when the destination directory does not exist, or verify an already completed matching copy. An incomplete existing directory is not overwritten and needs explicit administrative investigation. It does not activate either database.

`activateLocalCutover` verifies the ticket, target path, supplied runtime fingerprint and final data. It commits source retirement before enabling the target. Target content is rechecked under the target write lock. Activation writes a durable `writer_activation/current` receipt and active scope together. Repetition requires that receipt to match the exact transition, and remains valid after legitimate destination writes. A different transition, altered candidate or missing activation receipt is refused. Retired sources remain blocked on restart.

This ordering has a deliberate interval where neither side accepts writes, never an interval where both are enabled by these APIs. If target validation fails after source retirement, both stay stopped. Repair/recovery must preserve the exact final snapshot; retry can then finish activation. No API here silently discards later writes by reactivating a retired source.

## Snapshot compatibility

The table schema is unchanged. The snapshot accepts a well-formed same-scope fence and preserves it in the copy. Logical digest comparison normalises only this lifecycle scope to the original active scope; all other row values remain covered. `writer_activation` joins the explicit namespace inventory. A snapshot candidate copied from a fenced source is still fenced, so snapshot creation cannot activate it. The earlier exact-schema DDL pin remains valid.

## Verification

Tests cover an already-open member service and reopened stores, final admitted writes, original-proof settlement on the active target, source retirement, wrong ticket/runtime and changed content, concurrent activation, and exact repeated activation after target writes. An exclusive target lock plus injected counter change exercises failure after observed source retirement; both remain blocked and exact repair/retry succeeds. A simulated missing-copy state exercises preparation resumption. These are same-process connections and persisted-state simulations, not a new SIGKILL or cross-process cutover measurement.

## Deployment boundary and next work

These are internal trusted administrative APIs, exercised on generated fixture databases. No user's live path, listener or environment was changed. The runtime fingerprint is supplied by the trusted composition; this code does not introspect deployment settings or external providers. The next composition must calculate it from the actual immutable configuration and pass the same fingerprint at preparation and activation.

Every writer must use the updated atomic unit before fencing. An already-running old binary that omits the per-unit check, the standalone reference server, direct SQLite administration and external payment providers are outside this guarantee. Stop/exclude them before using these APIs for a deployment. A filesystem administrator can replace files or rewrite metadata; this is an application concurrency boundary, not protection against that administrator.

Next integrate the trusted composition's runtime fingerprint and active-path selection with the restricted authenticated member prepare/submit/outcome HTTP surface. Add request-authority/revocation tests and explicit activation reporting before mounting a listener. Then connect Swift native signing and interruption/reconciliation flows. Android remains the later platform phase.
