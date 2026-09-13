# Prepared statement authorisation

`openStatementAuthorisations` is an internal local service with prepare, read, verify and cancel operations. Each call constructs the engine and existing authority/login/binding/journal modules inside one atomic Store scope. It has no HTTP handler, settlement method, network adapter or native UI integration.

## Frozen review

Preparation accepts only an offer ID and disputed candidate IDs. It derives the mandate, presenter, household, credential, prices and expiry from trusted state. It requires a decided/expired physical offer with consumed lines, a current owned mandate, presenter grant, known carriage and no existing settlement. Disputes must be unique and name consumed lines. Candidate price/merchant/maker/carrier fields must match the stamped catalogue. Merchant disclosure blocks must exist and their signatures verify.

The revision hashes the actual offer, stamped catalogue, delivery, current mandate, recovery and member-facing review. Canonical bytes use the unchanged Valence statement builder, including carriage, consumed disputes and zero amounts for gifts. Snapshot storage is bounded to 256 KiB, and canonical bytes retain the journal's 64 KiB bound. Amounts and totals must be safe nonnegative integers. Full internal delivery data participates in the revision but its delivery code is not returned in the member review.

The stored review is checked against the operation's revision, canonical bytes and expected challenge when read. These checks detect inconsistent storage, not malicious rewriting of the database and all its fingerprints. Reads return the frozen review and explicit operation state, including expired/cancelled history when current authority permits it. They do not assert that old terms remain actionable. Verification rebuilds the current snapshot and refuses a changed review, including for an exact repeat of a previously verified authorisation.

## Contextual signature profile

The profile is `atarasy.member-statement-authorisation.1`. Its challenge is SHA-256/base64url of a deterministic array containing the profile, environment/origin/RP scope, operation ID, request digest and reviewed revision. The request digest already commits to the bound credential/key, offer/mandate/presenter, canonical statement and operation expiry. Object keys in snapshot hashing use fixed order; arrays preserve their meaning, and disputed IDs are sorted.

The random operation ID prevents an unused old assertion from approving a later preparation with the same canonical bytes. A cancelled operation is not reopened. Cancelling then preparing again creates a new ID and challenge. This protection also applies when the authenticator counter remains zero.

This is deliberately a separate member authorisation. The existing Valence engine checks a challenge made only from canonical statement bytes, and correctly rejects this contextual assertion as a settlement signature. Checking a revision on the server does not make that revision signed by a canonical-only assertion. No bridge between the two profiles is implemented. Before dispatch, specify and test an explicit protocol integration which preserves the complete signed context; do not weaken the proof or manufacture a household signature.

## Verifier and shared counters

Verification uses the pinned SimpleWebAuthn verifier through a new shared-only method on the existing login store. It requires the exact bound credential, challenge, RP ID, HTTPS origin, webauthn.get type, user presence and user verification. Cross-origin assertions and topOrigin are refused. Supplied user handles must match the registered credential; a null/absent handle is allowed because the verified session already selects the credential. Assertion JSON and base64url fields are bounded.

The verifier updates the same passkey counter and revision as login, using the existing library counter policy and a compare-and-swap update. Nonzero counter reuse across login and authorisation fails. For zero counters, unique challenges and one accepted proof per preparation supply operation replay separation. Exact repeated proofs return their durable record and do not advance the credential revision a second time; different proof bytes conflict once one is accepted.

Counter update and accepted-proof fingerprint commit together. A review-write failure rolls both back. Invalid attempts retain the prepared operation until expiry/cancellation; rate limiting remains a future HTTP-composition requirement. No assertion payload or bearer is stored by the authorisation record, only fingerprint, verified counter and time. All replies occur after outer COMMIT. The journal remains prepared and the local reservation remains held: verified authorisation is not dispatch or payment confirmation.

## Measurements and limits

The fixtures use the actual login verifier, P-256 keys and real engine physical offers. They cover correct verification, wrong credential/key/RP/origin/type/challenge/flags, cross-origin refusal, changed mandate/delivery/recovery/disclosure, cancellation and re-preparation, zero counters, login/authorisation contention, expiry/revocation, gifts/disputes, stored-review corruption, review-write failure and identical proofs through two service instances.

Some changed frozen-offer/recovery cases deliberately mutate stored fixtures to test invalidation; they are not claims that a public update route permits those changes. Concurrent authorisation tests use separate service connections in one process. The previously existing suite still measures process-death and revocation ordering separately; this increment adds no new native-device or provider measurement.

Two isolated negative controls remove current-review comparison or replace the contextual challenge with the legacy canonical challenge. Their focused probes must fail. [Validation](statement-authorisation-validation.json) pins the measurements, source/log hashes and exact tool versions.

Remaining work is explicit engine/protocol integration of this profile, immutable old-file migration, full writer adoption, derived-state reconstruction, provider intent/outcome recovery and native device acceptance. The original HTTP composition and Swift client are unchanged. This service uses one active transaction per instance; a caller must handle contention/refusal until a production composition defines queuing and response schemas. Lock duration, large-data throughput and actual Apple RP/origin configuration have not been measured.

## Subsequent integration

The baseline above describes the authorisation-only increment. The subsequent [contextual local settlement](CONTEXTUAL_SETTLEMENT.md) adds explicit Appendix A engine acceptance and an atomic internal `settle` method. Legacy canonical-only verification still rejects the contextual assertion; the new engine entry point verifies its complete envelope. No public write route or native ceremony is enabled.
