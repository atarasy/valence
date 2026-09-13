# Member transaction boundary: implementation contract

Status: proposed integration contract, no routes implemented or enabled. Baseline engine and read/login boundary: `5254b7cc74f993062a72d762b4f9dd4236278e45`. This document does not amend protocol canonical formats or claim conformance for an unbuilt adapter.

## Existing boundary and blockers

The member gate exposes authenticated reads, not `POST /offers/{id}/decisions` or `/settle`. The login database verifies a registered credential and issues an authority session. The engine separately resolves the identity registered under `offer.mandate`. There is no implemented proof that these keys are the same authorised member key. Never register or replace that identity from a client-supplied household/mandate name, forward a bearer as transaction proof, or sign on the member's behalf.

Physical settlement exposes the submitted public signature as `confirmation`. Its lines and amounts support read-back comparison with a frozen statement. The receipt excludes carriage and does not establish provider payment. Digital offer detail does not expose the consumed confirmation tokens; equal choices do not identify the operation that recorded them.

`engine.decide` and `engine.settle` await external day, mandate, delivery and ledger work. Adding pre/post session checks to an HTTP proxy does not close concurrent state changes or the crash interval after a ledger effect. Engine state, the operation journal and external effect idempotency must share an explicit commit/recovery design before dispatch is enabled.

## Proposed operation lifecycle

| Phase | Durable fact | Permitted action |
|---|---|---|
| prepared | Owned offer, principal/credential binding, environment, operation kind, canonical challenge, reviewed term fingerprint, expiry | Request a system-authenticator assertion for these bytes |
| cancelled | No dispatch claim was made | Leave review; retain no assertion |
| dispatching | Operation claimed exactly once before effects, assertion fingerprint and request digest fixed | Execute through a commit adapter with checked expected state |
| committed | Authoritative engine operation receipt and effect references persisted | Return the same receipt to scoped reads |
| refused | Commit adapter proves refusal before any effect | Present refusal; create a fresh review if appropriate |
| uncertain | Dispatch may have produced an effect or durable completion cannot be proven | Read/recover the same operation; never create a fresh charge automatically |

An operation ID is opaque, random and server issued, scoped to environment and principal. Duplicate submission with identical digest returns the same operation state; different bytes under the same ID conflict. A timed-out request is not `refused`. A 404 read is not proof that dispatch had no effect. A session replacement may resume an owned operation only through a newly authenticated server ownership check, never by matching a locally typed household.

## Preparation and dispatch requirements

1. Resolve a live session and credential from trusted storage. Bind engine mandate identity to that verified credential using a provisioning record that cannot rebind an existing identity.
2. Read owned offer, governing disclosure versions, delivery and mandate version under a consistent revision. Fingerprint all displayed terms, not only fields currently covered by the protocol challenge. Never change existing canonical bytes silently.
3. Digital decisions include every still-offered candidate exactly once. Physical statements contain every eligible kept/defaulted/consumed line. Only consumed lines may be disputed. Unknown carriage blocks a physical statement operation.
4. Bind the system assertion to the expected RP, allowed origin, UV, credential and exact challenge. Enforce replay/counter policy centrally across login and transaction ceremonies. Retain public verification material only as required for recovery; no private signing key belongs in the hub.
5. Atomically claim the operation and verify current authority, reviewed revision, grant and resource ownership at the effect boundary. Define whether a revocation racing with an already claimed operation precedes or follows that boundary.
6. Serialise conflicting decisions, collections, withdrawals and settlements for the same offer. An in-process mutex cannot establish this across service instances or restarts.
7. Use stable external effect IDs. Persist dispatch before effects and persist/read authoritative outcome after effects. Test process death at each boundary, including after ledger commit and before the response.

## Proposed member HTTP contract

Route names and exact schemas are not enabled until the commit adapter exists. Intended operations are prepare, submit the same operation, and read that owned operation. Each response must be bounded no-store JSON and exclude internal exception messages, credentials, delivery codes and other households. Redirects are not followed. The existing read gate remains unchanged.

An operation receipt needs the operation ID, kind, resource, principal scope, request/challenge fingerprint, reviewed revision, authoritative status, and exact effect/confirmation reference. A digital status cannot be implemented by polling candidate valences. A physical status may use the existing confirmation plus complete line/amount comparison, but must not label it a provider charge confirmation.

## Acceptance matrix before enabling writes

- Wrong principal, resource, environment, credential, mandate binding and revoked grants refused before dispatch.
- Missing/changed carriage, altered disclosure version, recovery or mandate revision invalidates preparation.
- UV/RP/origin/challenge mismatch and reused assertions rejected; credential counter races handled across ceremonies.
- Two tabs with different disputes cannot receive the other's success; identical duplicate dispatch produces one effect.
- Separate service instances and restart tests prove operation claiming and recovery, not only in-memory state transitions.
- Lost response, 404, 401, malformed read-back and unavailable provider retain uncertainty without an automatic retry.
- Read-back rejects a different confirmation, same total with different lines, gift charges, disputed-line inclusion and foreign payer/presenter.
- Native device evidence uses an actual configured system authenticator. Fixture private-key signing proves the engine contract only.

## Current implementation boundary

The Atarasy core increment prepares physical statement bytes and checks read-back evidence. It neither provisions transaction authority nor dispatches a write. No API in this experiment is exposed by the member handler. Durable operation storage, digital operation receipts and the commit adapter remain required implementation work.
