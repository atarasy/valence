# Contextual digital withdrawal candidate

The engine now exposes `memberWithdrawalReview` and `withdrawMember`. This is the verification primitive for the upcoming authenticated member HTTP workflow, not a deployed endpoint. `memberWithdrawalScope` must explicitly enable the deployment environment and HTTPS origin, matching the RP ID. Decision and statement scopes alone do not enable withdrawal.

The profile is `atarasy.member-withdrawal-authorisation.1`; the operation request domain is `atarasy.member-withdrawal-operation.1`. Envelope fields and contextual challenge layout follow the existing decision envelope, with distinct profile/domain constants. All authority fields, reviewed revision, canonical action, expiry, key fingerprint and request digest are covered. The engine verifies actual assertion bytes, exact origin, UP/UV and deployment context; it never accepts an arbitrary expected challenge or a verification boolean.

Canonical action bytes are newline-separated `valence.member-withdrawal.1`, offer ID, decided timestamp and decision revision. The revision hashes the JSON array `["valence.member-decision-generation.1", offer ID, decided timestamp, candidate tuples, retained confirmation tokens]`. Each candidate tuple is `[id, valence, kept_as, lineage, decided_at]` in the stored offer order. The confirmation register is retained after withdrawal and grows with each new signature, so even identical choices made again at the identical timestamp cannot accept the previous generation's withdrawal proof. Only the digest is exposed by the review helper; raw confirmation tokens are not returned.

The internal withdrawal state transition remains shared with the existing protocol path: a signed, unsettled digital decision is required for the contextual entry point; cooling restrictions and settlement finality still apply. The legacy withdrawal API does not accept contextual assertions. The existing legacy canonical protocol has not been changed by this candidate.

## Verified scope

Six focused tests cover valid withdrawal, legacy-route separation, same-choice/same-millisecond redecision replay, explicit deployment opt-in, physical binding refusal, current-generation binding, tampered context, foreign origin, missing UV, expiry, no cooling, closed cooling and settled refusal. All 296 engine tests and the engine strict typecheck pass.

## Next implementation

The authenticated PostgreSQL prepare/submit/cancel/readback adapter, durable withdrawal outcomes and native screen remain unimplemented. The current `one_blocking_member_statement` unique index still includes committed operations. Do not delete original decisions or relabel them cancelled to make a new decision fit. Introduce an explicit decision incarnation in the journal/database contract, retain old committed operation results and require an atomically verified withdrawal to advance the current incarnation. Physical statement uniqueness and historical reader compatibility must remain proven. Bind the withdrawal review to the original operation, current engine decision revision and session authority, then commit engine state, passkey counter, withdrawal result and successor-incarnation eligibility in one PostgreSQL unit. Race, crash/rollback, lost response, stale generation and restarted-reader tests are required before enabling any route.

The engine alone supplies no HTTP session/counter serialization. Its deployment adapter must hold the existing database transaction lock, as digital decisions already do. No HTTP route, provider call, schema migration or operational gate is enabled by this increment.
