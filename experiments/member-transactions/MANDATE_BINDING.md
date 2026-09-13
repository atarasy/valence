# Existing mandate credential bridge

`openMandateBindings(path, authority, login, engine)` is a trusted internal component. It is not wired to the member HTTP handler and enables no transaction route. `bind(token, mandate)` records an immutable relationship only after the authoritative session owns the mandate and the verified login public key matches the existing engine identity. `resolve(token, mandate)` requires that stored relationship and rechecks current authority and key state.

The authority lookup returns detached principal, credential, household, session expiry and presenter grants. Login exposes detached active public-key bytes only. These methods are internal accessors, not new response fields. The bridge never registers, replaces or endorses an engine key and never persists bearer tokens or private keys.

The initial key profile is a five-field COSE EC2/ES256/P-256 key with valid 32-byte coordinates, no additional fields and byte-preserving CBOR re-encoding. It is converted to SPKI DER and compared to canonical DER from the engine PEM. Alternate PEM formatting does not change key identity. Duplicate/trailing CBOR and unsupported profiles are refused. Real native-platform compatibility has not yet been measured.

The binding SQLite database records scope and mandate/principal/credential/household/public-key fingerprint. A same-input bind is idempotent; a different credential cannot overwrite a mandate even for the same household and same public key. Multiple authenticators and rotation need an explicit future design. Session, credential, principal, grant and mandate-ownership revocation prevent later resolution. Expiry and RP scope are checked again. A second database connection and close/reopen preserve exact records.

Resolution returns precondition evidence with its session expiry and presenter grants. It does not check an individual offer, prepare signed bytes, verify a transaction assertion, claim an operation, or authorise effects. Empty presenter grants do not become an offer grant. Another process can revoke authority after a snapshot is read; the future dispatcher must revalidate at its atomic effect boundary. The database transaction here is not a distributed lock or crash-safe financial operation.

## Verification

```
bun test experiments/member-transactions/mandate-binding.test.ts experiments/member-read experiments/member-login
```

The tests use actual authority/login databases, the pinned SimpleWebAuthn verifier, independent P-256 fixture assertions and the actual engine identity registry. A secondary-credential session uses an explicitly identified trusted fixture setup. No real device or member transaction assertion is measured. The mutable engine-view and altered-environment cases use explicit adapters to test fail-closed scope checks; the actual engine configuration is immutable.

Coverage includes equal/different engine keys, absent and foreign mandates, immutable records, detached snapshots, inactive enrolment, unsupported COSE and invalid curve points, revocation, scope and multiple connections. The negative control removes key equality and must fail the different-engine-key test. The tests do not establish simultaneous cross-process writes, process-kill recovery, initial identity provisioning or transaction dispatch.

[Validation](mandate-binding-validation.json) records exact source, log and dependency hashes. Engine source, member HTTP routes and iOS UI are unchanged, so their historical mutation/device measurements are not relabelled as this increment's evidence.
