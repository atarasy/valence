# Contextual local statement settlement

## Scope

The opt-in profile in SPEC Appendix A accepts the challenge prepared by doc46. Legacy canonical statement bytes and signatures remain supported through the existing entry point. The new internal engine method receives the complete envelope and original WebAuthn assertion. Configuration supplies environment, HTTPS origin and RP; nested scope is copied and frozen. No request can supply an expected challenge or an accepted-signature boolean.

## Validation and storage

The engine checks exact envelope fields, identifier/digest/time bounds, key fingerprint, offer/mandate/household/presenter, current canonical statement including carriage, reconstructed request digest and contextual challenge. It verifies the registered mandate key, origin, RP, type, presence and verification, and refuses cross-origin/top-origin assertions. Base64url fields are canonical and bounded. The assertion is checked again against the actual canonical bytes used for settlement if delivery reads differ.

`member_statement_confirmations` is a map in the unified engine store. It records an identity digest of contextual signed bytes and the exact assertion fields beside the settlement. Fresh runtimes can recognise an exact operation/proof repeat; another operation, even with a valid new signature for identical statement bytes, conflicts. A legacy signed call cannot claim a contextual receipt merely by copying its raw signature. An unsigned legacy read keeps its existing receipt behaviour.

The member adapter reconstructs authoritative terms and compares the complete reviewed revision before both new and previously verified approvals settle. It checks the selected credential/counter with the pinned login verifier, claims the owned operation, calls the engine, and records the receipt digest before the outer commit. A previously verified exact assertion uses its stored verification record, avoiding a second counter advancement; the engine still verifies its cryptography. Every effect uses fresh modules and local ledger/delivery/mandate/day sources in the same scoped database.

Committed retries check current authority, exact accepted assertion fingerprint and actual stored receipt digest. They return the receipt even after operation expiry while the session remains valid. They do not reconstruct an actionable review, update counters or execute the ledger again. Other pending/outcome states are not reset. Failure before outer commit rolls back the claim and all local effects, so the same operation and proof may be retried after a proven rollback.

## Limits and next work

This is internal service and reference-engine code. It adds no HTTP field, native authentication UI, device evidence, external payment call or full conformance claim. Fixture P-256 keys produce real cryptographic proofs, but are not device ceremonies. Database-trigger failure tests are not a new contextual-process-kill measurement; the existing atomic-store process tests are regression coverage only.

Before enabling member writes, reconstruct process-local candidate/lineage indexes from stored state, inventory and adopt every writer, and rehearse existing-file migration/cutover. Then specify and implement a restricted member prepare/submit/outcome HTTP surface and Swift integration. External ledger effects need their own uncertainty and reconciliation protocol; local rollback cannot promise remote rollback. Android remains a later phase.
