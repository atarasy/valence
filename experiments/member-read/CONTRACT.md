# Member read boundary experiment

This opt-in experiment implements a deployment boundary around selected existing GET routes. It does not change the public protocol, the reference server or its identity roots. The member application never supplies a trusted principal directly. `resolveSession` and `ownerOf` must be authoritative server-side dependencies; the original gate tests supply synthetic implementations. The opt-in durable adapter in [AUTHORITY.md](AUTHORITY.md) now supplies local SQLite dependencies, with synthetic provisioning in tests.

Permitted routes are `/offers?household=...&presenter=...`, `/offers/{id}`, `/offers/{id}/approval`, `/offers/{id}/statement`, `/offers/{id}/settlement` and `/_node/mandates/{id}`. Only GET is permitted. Resource path IDs use ASCII letters/digits/underscore/hyphen in this bounded adapter; this is not a protocol identifier restriction. Extra/encoded path segments and unknown/duplicate query parameters are rejected. The configured HTTPS origin and environment must match.

A session supplies its ID, environment, household, allowed presenters, expiry and revoked flag. Resource ownership is read independently of request parameters. The gate rechecks the session and ownership around asynchronous work and checks the returned projection's resource binding. Denial before forwarding invokes no reference handler. Refusals are neutral, private responses are no-store, and internal exception messages never leave the wrapper. An unknown resource and another household's resource have the same status and body; timing indistinguishability is not claimed.

These checks do not make an unverified token trustworthy. A production resolver must verify credentials, audience, expiry and revocation through a selected authoritative system. No production token issuer, login/registration, cookie policy, WebAuthn verifier or production ownership integration is implemented here. The durable adapter can issue opaque sessions only through a trusted internal call following a separately verified login; it does not perform that verification. No writes, merchant/co-signer roles, private delivery, export or recovery are exposed. Separate authorised boundaries remain required for them. A final recheck cannot prevent revocation immediately after that check; distributed consistency is unresolved.

The ownership index must contain immutable offer household/presenter bindings and mandate household bindings from validated durable state. The durable experiment stores only authority bindings and session/credential references, not a second copy of household content, and exposes no index to a merchant. A production implementation must place it within the selected private-data architecture and test migrations and invalidation.

Run only these isolated tests with Bun:

```sh
bun test experiments/member-read/gate.test.ts
```

The integration case invokes the actual reference Request/Response handler in process, with an in-memory engine seeded through its test helper. It opens no listener and contacts no provider. These tests are deployment experiments, not conformance probes or a new mutation score. The existing engine source and conformance input are unchanged.

The local projection checker supports only the constructs present in the committed schemas. It refuses unsupported schema features at startup and is not a general JSON Schema implementation. Captured projections are independently validated with Python jsonschema in the client contract pack. The wrapper rejects extra fields recursively, including private data added inside candidate records, before returning an allowed projection. Statuses 400/409/422 retain a bounded protocol code with neutral text; 404 is normalised and internal errors become neutral unavailable results. No status creates permission to retry a mutation.

Schema and fixture provenance is recorded in `schema-sources.json`, pinned to the application contract commit. A contract update must update these copies and repeat scope/projection tests deliberately. The source commit in `validation.json` identifies the unchanged engine baseline. The tests are ordinary boundary tests, with a separate actual-handler case; their count is not a conformance or mutation score.
