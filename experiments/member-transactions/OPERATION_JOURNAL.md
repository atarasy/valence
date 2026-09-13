# Internal physical statement journal

`openOperationJournal` provides durable preparation records, owned reads and atomic claims. It enables no member route and executes no engine/provider effect. The server preparation adapter must validate the actual offer-to-mandate relationship, canonical statement semantics, disputes and a consistent reviewed revision before calling it. The journal itself checks scope, authoritative offer ownership and presenter grants, stores exact bytes and checks their fingerprints; a canonical prefix check is not semantic statement validation.

## Stored identity and replay behaviour

Each row fixes a random operation ID, physical offer, principal, credential, household, mandate, key fingerprint, canonical bytes, reviewed revision, expiry and derived request digest/challenge. The request digest uses fixed field order, so object-property reordering does not create a new request. No bearer token or assertion payload is stored. Authentication is resolved through the existing credential bridge on each member-facing internal call.

The same preparation returns its existing row, including after its preparation expiry, so a lost preparation response does not strand the operation ID. Expiry still blocks a first claim. A newly authenticated session for the same credential can read its owned history. Changed terms conflict with a blocking operation instead of creating another one. A partial unique index keeps one prepared, dispatching, uncertain or committed physical statement per offer.

| API | Requirement | Result |
|---|---|---|
| `prepare` | Trusted server terms and current owned binding | Persist or retrieve exactly matching operation |
| `read` | Current same principal/credential binding, offer ownership and presenter grant | Detached stored state, including expired history |
| `claimVerified` | Trusted adapter has verified assertion and current reviewed revision; exact request/proof fingerprints | Only prepared-to-dispatching caller gets `acquired: true` |
| repeated claim | Same operation and assertion fingerprint | Recorded state with `acquired: false`, never a fresh effect |
| `cancel` | Current ownership and no dispatch | Cancel; permit a fresh preparation |
| `refuseBeforeDispatch` | Trusted internal proof of pre-dispatch refusal | Refused; permit a fresh preparation |
| `markUncertain` | Existing dispatching record | Preserve the blocking claim, without resetting it |
| `recordCommitted` | Trusted internal authoritative recovery evidence and exact assertion/receipt fingerprints | Pin outcome; a different confirmation or receipt conflicts |

`claimVerified` does not verify an assertion cryptographically. The future dispatcher must not treat it as a public API, and must submit no effect when `acquired` is false. Internal outcome methods trust a recovery adapter; accepting a receipt digest here does not prove that receipt or its provider effect.

## Persistence and concurrency boundary

SQLite uses WAL, synchronous FULL and immediate transactions for state changes. The row is read under the transaction before granting a claim, and the new state is persisted before the method returns. Startup verifies scope metadata and the required unique index. Reads validate the stored request/challenge digest and state-dependent fields. These checks detect accidental inconsistent storage, not malicious rewriting of a writable database and all its hashes.

A crash after claiming never resets the row. Dispatching remains unresolved until a recovery adapter records uncertainty or an authoritative outcome. There is no lease expiry, claim recycling, automatic retry or new statement while the old outcome is uncertain. Committed records also retain the offer slot. Cancellation and refusal cannot clear a claim after dispatch began.

The journal checks a synchronous detached offer-ownership snapshot and live binding inside its SQLite transition. Authority, binding and journal use separate stores; this is not an atomic distributed revocation/commit boundary. The engine's own collections, withdrawals and external effects do not acquire this journal's lock. A correct dispatcher still needs expected-state checks and stable external effect IDs across all competing writers.

## Measurements

```
bun test experiments/member-transactions/operation-journal.test.ts experiments/member-transactions/mandate-binding.test.ts experiments/member-read experiments/member-login
```

The fixture uses actual authority/login/binding databases, verified fixture credentials and synthetic server-prepared statement terms. It does not create or settle a corresponding actual engine offer. Worker processes open the real stores independently and synchronise at a start barrier. Only the worker receiving a new claim appends to a synthetic effect log; the log is not a payment ledger.

Three child-process checkpoints are forced to stop with observed SIGKILL: after the durable claim before the synthetic effect; after that effect before receipt persistence; and after receipt persistence. Reopening returns dispatching for the first two and committed for the last. Every repeated claim is false; the effect log has zero or one entry as appropriate. This proves the journal's claim persistence and recovery states, not exactly-once provider execution.

A separate negative-control copy disables the prepared-state guard. The repeated-claim test then fails because a second caller acquires the operation. [Validation](operation-journal-validation.json) pins source, logs, dependency versions and the mutation.

## Remaining integration

- Consistent server-side statement preparation and transaction assertion verification.
- An atomic engine/authority/effect boundary, stable provider effect IDs and authoritative outcome recovery.
- Owned HTTP schemas and Swift integration, including digital operation-specific receipts.
- Initial identity provisioning, actual native device ceremonies and provider measurements.

Member HTTP routes, engine source and the iOS UI remain unchanged in this increment.
