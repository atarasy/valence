# Durable member authority adapter

This opt-in adapter implements the dependency contract in CONTRACT.md with a dedicated SQLite file. It has no HTTP surface. Its administrative functions are trusted capabilities, never handlers for client-supplied claims. Existing reference server wiring and protocol signatures stay unchanged.

Open with an explicit environment, HTTPS audience and maximum session lifetime. The database records schema version 1 and environment/audience binding; unknown schemas and mismatches fail. Lookups query current rows on every call, including across connections. No in-memory grant cache is used. Transactions use Bun SQLite's immediate transaction API; see [Bun SQLite](https://bun.sh/docs/runtime/sqlite).

Provision a principal with an immutable household and initial presenter grants; register a credential reference against that principal. Credential references are identifiers for a future verifier, not verified assertions. `createSessionAfterVerification` may only be invoked by trusted code after independently completing a verified login ceremony. It generates a 256-bit opaque random token, persists only a domain/environment/audience-bound SHA-256 digest, and returns the token once. Expiry must be in the future and within the configured maximum. No refresh or token import is supported.

Disabling a principal and revoking a credential are terminal. Changing grants revokes all existing principal sessions in the same transaction. Creating a new session afterwards requires a new verified login. Session IDs and credential/principal bindings cannot be reused to resurrect revoked sessions. Returned records are detached values.

Resource binding is immutable and idempotent only for exactly the same active ownership. Invalidation retains a terminal tombstone, so resource IDs cannot be rebound. Kind separates offer and mandate namespaces. Only trusted provisioning code that has validated durable engine state may bind ownership. This adapter does not yet atomically create engine resources or reconcile their state.

The read gate consumes `resolveSession` and `ownerOf` directly. It must use the same environment and audience as this store. Failures propagate into its neutral unavailable response. Expired, revoked or unknown tokens resolve to no session. The final-check-to-delivery race remains; a second connection's committed revocation is visible on the next lookup, not retroactively after delivery.

Schema migration, encryption, filesystem protection, backup rollback/revocation recovery, multi-host operation, login verification, rate limits and native credentials remain release work. The test suite uses temporary local files and synthetic principals only. Run `bun test experiments/member-read` for the bounded experiment suite. Historical validation.json remains pinned to the earlier in-memory experiment; new evidence is recorded separately.

Follow-up: [verified login and durable ownership integration](../member-login/CONTRACT.md) connects a pinned assertion verifier and reconciles ownership from persisted engine records. Lists now check ownership per returned row. Enrollment, public transport and deployment remain separate. Historical validation records retain their original source hashes.
