# Atomic local engine unit of work

`openAtomicStore` is an internal experimental implementation of the existing engine Store interface. `run` acquires a database-wide SQLite write lock before exposing a Store. Construct a fresh engine and its local ledger/registers inside that scope, await local work, and return serialisable data. Every map write participates in the same transaction. Exceptions and unserialisable results roll back. The return value is detached before commit; map writes and new maps from an ended scope are refused.

The format is separate from the original write-through store and from the member operation journal. It refuses foreign tables and a mismatched environment/audience. It uses WAL and synchronous FULL. Lock acquisition retries SQLITE_BUSY asynchronously with a bounded wait so local awaited calls in the owning connection can finish. Only one run per connection is allowed; use another connection for a contender. A database-wide lock is intentional: an offer-only lock would not protect a household daily ceiling shared by different offers.

## Actual engine measurements

The fixture creates, presents, delivers and collects actual physical offers through the existing engine and registers. It uses a trusted imported fixture mandate, fixture Ed25519 signatures and the reference local reservation ledger. Carriage of 550 is covered by the statement; the ledger commits goods of 1200, as the existing protocol separates carriage. It does not charge a payment provider or use a native authenticator.

Tests cover a complete local settlement and exact repeated receipt, failures after reservation/receipt/household-day writes, detached results, expired scopes, lock timeout and recovery, concurrent connections and a competing withdrawal. Two independent processes synchronised at a start barrier test the same offer and two offers sharing a daily ceiling of 1500. The latter commits one 1200 settlement and refuses the other with mandate_ceiling_daily.

Child processes are stopped with observed SIGKILL after each of three internal writes and after the outer COMMIT. Before COMMIT, reopening finds the reservation still held, no receipt or household-day row, and the offer still decided. After COMMIT, all four records survive. A repeated fixture statement then yields one final local receipt and one household-day row. This local rollback experiment does not authorise resetting a dispatching record in the separate member operation journal.

A negative-control copy replaces ROLLBACK with COMMIT on callback failure. The actual-engine rollback probe then detects a committed reservation with no corresponding receipt. [Validation](atomic-store-validation.json) records the final measurements and hashes.

## Competing writers requiring adoption

| Writer or dependency | Existing entry points | Required ordering |
|---|---|---|
| Offer lifecycle and reservation | createOffer, present, decide, withdrawDecisions, withdraw, settle | Fresh state and all local writes within the unit |
| Collection and expiry | recoveries.collect, applyRecoveryTo, sweep | Collection record and derived offer state together |
| Reads which apply expiry | mustGet with time, offersForHousehold, offersForPresenter, unionForHousehold | Treat as writes; do not retain a cached engine outside the unit |
| Terms and identity | registerConfig, putDisclosure, registerIdentity, mandates.record | Serialise changes with preparation/revision checks and settlement |
| Delivery and household day | DeliveryRegister.record/importRows, HouseholdLedger.record/recordOffer/importRows | Same database owner; do not read another stale copy |
| Imports | Offer, settlement, note, edge, receipt, recovery, confirmation and mandate import methods; node import composition | Entire validated import as one unit, including reconstructed indexes |
| Other local registries | Notes, lineage, permissions, approvals, recovery permissions, merchant registry | Adopt the same storage/lifetime contract before routing through a fresh runtime |
| Member authority | Session/credential/principal revocation, presenter grants, resource invalidation | Still separate stores; require canonical authority and revision/counter ordering inside the final boundary |
| Login and transaction proof | Credential counter and replay updates; immutable binding; operation journal claim/outcome | Still separate stores; require one authoritative commit protocol |
| Remote adapters | RemoteMandates, RemoteDay, RemoteDeliveries, MeterLedger | Excluded from this unit; network effects require outbox/idempotency/outcome recovery |

The current server constructs a long-lived engine using the original store. It has not adopted this primitive, and no HTTP route is enabled or made atomic by these tests. Source review also finds process-local candidateIndex and receipts maps in ValenceEngine. Reconstructing or persisting their state is a prerequisite for migrating note/lineage/import operations to fresh runtimes; the physical settlement fixture does not exercise those surfaces. The inventory names required adoption work, not tested coverage of every writer.

## Limits and next integration

The callback is trusted local code, not a plugin or a member-controlled function. Await all work, do not return a live engine/map, and do not introduce network effects. There is no callback execution timeout or distributed lock lease: slow work can hold the local database lock until completion or process death. Large databases need transaction-duration and throughput measurements before deployment. Opening a new store while another process writes may wait synchronously during schema validation; normal run contention uses asynchronous bounded retries.

This module has no transaction assertion verifier, current reviewed-revision check, operation-specific effect ID, external outbox or provider recovery. The engine's existing offer ID remains the local reservation idempotency key. It does not share a transaction with the member authority, verified login, mandate binding or operation journal. Revocation racing with settlement therefore remains unresolved for member dispatch.

Next, define the canonical authority/counter/journal storage migration and its ordering with local engine state, including secure provisioning and credential binding. Build consistent server preparation and actual transaction assertion verification. For split roles or external payment effects, use a separate durable intent/outcome protocol with stable effect IDs and retain uncertainty after ambiguous responses. Adopt every competing writer and repair derived-state reconstruction before enabling a member write route or native signing.

## Co-located follow-up

[Unified local member storage](UNIFIED_STORAGE.md) now lets the existing authority, login, binding and journal modules join this unit through scoped database capabilities. Their co-located fixture ordering is measured separately from the earlier local-engine-only results above. Existing standalone deployments and the HTTP composition have not been migrated.
