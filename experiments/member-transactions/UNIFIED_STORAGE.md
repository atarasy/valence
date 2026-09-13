# Co-located local member storage

The existing member authority, verified-login, mandate-binding and operation-journal constructors accept either their previous standalone file path or a scoped database capability from `openAtomicStore.run`. Their schemas and domain checks remain in their original modules. In shared mode they initialise/check only their own tables, skip connection-wide pragmas and use nested SQLite savepoints. The outer Store owns WAL, synchronous FULL, foreign keys and the final transaction.

A shared capability is registered in a WeakMap and carries a frozen environment/audience. Its connection exposes guarded run/query/transaction operations only, with guarded prepared statements. It does not expose a raw connection handle. Every database call checks that the outer scope is still active. A component close is a no-op inside that scope, and cannot close the parent transaction. Shared authority/login/binding/journal participants must come from the same capability. Both directions of shared/standalone mixing are refused. A new scope must reconstruct all participants.

## Commit and revocation order

| First owner of the write lock | Later contender | Result |
|---|---|---|
| Credential/session/principal revocation, grant removal or ownership invalidation | Operation claim and settlement | The current authority check refuses before effects |
| Local claim and settlement | Revocation | Local operation/receipt/effects commit first; revocation follows and blocks later member access |
| Local claim followed by exception or process death before COMMIT | Later caller | Claim and all local effects roll back; the operation remains prepared |
| Complete local commit followed by response loss or process death | Same operation read/repetition | The committed operation and exact receipt survive; no second effect |

The database-wide lock also retains the previous protection for the household day across offers. It is the local commit ordering, not a promise that a revocation interrupts a transaction which already owns the lock. All revocation writers must actually use this canonical database for that ordering to apply.

The test composition places a real journal claim, actual physical engine settlement and exact receipt digest in one unit. Before COMMIT none is independently durable. No external effect is executed. This local rollback case does not change the separate journal's rule for dispatching/uncertain external operations.

## Login counter and failure semantics

The existing SimpleWebAuthn verifier runs against the credential snapshot within the transaction. Its counter/revision update and authoritative session issuance then commit with the unit. No bearer token may be sent before run returns successfully. A failure after issuance which rolls back the unit leaves that uncommitted token unusable and restores the counter/challenge.

To retain consume-on-failed-verification behaviour in shared mode, the composition must catch a verification failure inside the callback and return a bounded failure result, allowing the consumed challenge to commit. Letting the exception escape rolls back that deletion. A process death cannot preserve it selectively. The fixture tests both cases, plus two login flows using the same nonzero counter. This is storage/counter integration for login; it is not transaction assertion verification. The standalone login implementation retains its existing behaviour.

## Evidence

Fixtures use actual authority and login implementations, the pinned SimpleWebAuthn verifier, immutable key binding, the operation journal and actual engine physical offer/collection/settlement. A single fixture P-256 key links login, mandate and statement. The reference local reservation ledger records effects; no payment provider is involved. The reviewed revision and transaction proof acceptance are trusted fixture values.

Separate workers are ready before either is released. The first pauses while holding the transaction; the second attempts its competing operation and remains pending until the first is released. Both revocation-first and settlement-first orderings are checked. Other process tests observe SIGKILL after claim, after engine settlement, after journal outcome and after outer COMMIT. Reopening shows either the complete previous state or complete committed state.

A negative-control copy commits callback failures instead of rolling back. The unified probe then detects a partially recorded operation/effect. [Validation](unified-storage-validation.json) pins sources, logs, exact measurements and the negative control.

## Cutover requirements and remaining work

This is an internal co-location capability and fixture composition, not a deployed member dispatcher. The original HTTP composition and iOS client are unchanged. Existing standalone authority/login/binding/journal files are not copied, attached, dual-written or abandoned automatically.

A future offline cutover must stop every old writer, retain immutable backups and verify environment/audience/RP consistency, relationships and source digests. Copy principals, credentials, session digests/expiry/revocation, ownership invalidations, active passkeys/counters/revisions, bindings and every journal state without changing identities or reviving permissions. Preserve unresolved and committed blocking operations. Decide explicitly whether to discard uncompleted login challenges. Validate target counts and fingerprints, switch every reader/writer together, and prevent old files from becoming active again. A migration tested on fixtures is still not permission to cut over a live service. No such migration is executed in this increment.

Before member writes, implement a non-fixture composition with consistent reviewed snapshots and actual transaction assertions, including a shared login/transaction counter/replay policy. Migrate all engine/hub writers and resolve candidate-index/received-lineage reconstruction for fresh runtimes. Credential provisioning and multi-device/rotation policy remain required. Remote payments need stable effect IDs, a durable intent/outcome protocol and authoritative recovery. Holding this database transaction around a network effect would not make that effect reversible.

Cryptographic verification currently holds the local write lock. The Store has no execution-time limit for its callback; lock-duration/throughput measurements and an optimistic verify-then-recheck design may be needed before deployment. Expired history may be inspected only under current authority; a revoked member cannot bypass checks by requesting an old receipt. Admin recovery is a separate trusted surface, not an enabled member endpoint.
