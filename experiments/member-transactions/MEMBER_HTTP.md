# Authenticated member HTTP runtime

`openMemberHTTP(path, config)` selects an existing canonical database path supplied by trusted composition. It returns a callable `fetch(Request): Promise<Response>`, descriptor, administrative cutover methods and close method. It does not open a listener or accept path/configuration from HTTP callers.

## Runtime identity and cutover

The exact configuration includes environment, HTTPS origin, RP ID, exploration rate, reminder limit, recovery grace days, UTC day boundary, authorisation/session lifetimes, body limits/timeouts, admission and token budget limits. The runtime clones and freezes it, rejects unknown fields, sorts keys and hashes `['atarasy.member-runtime.1', orderedConfiguration]` with SHA-256. This fingerprints configuration, not the binary, native entitlement or external providers.

Opening binds the configuration and fingerprint in `member_runtime/current` within an atomic unit. Existing bindings and any activation receipt must match. Snapshot namespace validation includes this row; its bytes participate in the final snapshot digest. The trusted `prepareCutover(directory)` and `activateCutover(ticket)` wrappers derive the fingerprint from the same immutable configuration. After activation, composition must explicitly open the reported target with matching configuration. Existing source instances stay fenced. The descriptor identifies the actual canonical path and computed fingerprint.

## Member routes

| Method | Path | Input/result |
|---|---|---|
| POST | `/member/statements/prepare` | `{offer, disputed}`; frozen review, operation ID and contextual WebAuthn challenge |
| GET | `/member/operations/:id` | Owned frozen review |
| POST | `/member/operations/:id/submit` | `{assertion}`; cryptographically verified atomic settlement and receipt |
| GET | `/member/operations/:id/outcome` | Operation state and committed receipt, otherwise null receipt |
| POST | `/member/operations/:id/cancel` | Empty object; existing journal cancellation semantics |

Every route requires a bearer from the existing verified-session service and current server-side resource authority. Principal, credential and household identity cannot be injected through the request body. Outcome reads check current ownership, saved review, verified assertion fingerprint and committed receipt digest; they need neither the original assertion nor another settlement attempt. Revocation blocks subsequent reads and submission. Unknown/admin paths have no fallback router.

All responses set `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`. Malformed or missing bearer syntax returns 401. Resource and authority failures share 404 to avoid exposing another member's operations. Invalid transport/body returns 400; wrong method 405; exhausted token budget 429; admission exhaustion or writer fencing 503. Clients must not infer expiry, revocation or nonexistence individually from a generic 404.

POST bodies are bounded UTF-8 JSON streams with a deadline. Admission includes body reading and queued database work; a stalled body releases admission on timeout. Work is serialised per instance. Budgets retain only token hashes in bounded process memory, never raw bearer strings. They are per token and process, not principal or distributed limits. Valid-looking unknown tokens can consume budget slots. Public deployment still needs an ingress/abuse policy, lifecycle handling and deployment configuration.

## Verification and limits

The regression suite passes 294 tests, 1,323 assertions across 29 files, including eight new member HTTP tests. Strict TypeScript passes. Tests use generated SQLite fixtures and real P-256/WebAuthn signing/verification, an already-created verified session, same-process cutover and the callable HTTP surface. They cover foreign/unknown/revoked sessions, exact retry/outcome, corrupted receipts, configuration mismatch, target activation and source fencing, route exclusion, body limits/timeouts, admission, budgets and cancellation.

Two isolated negative controls each fail the intended test: removing receipt-integrity validation returns a corrupt receipt as success; removing existing runtime-binding checks permits mismatched configuration. Logs and source hashes are recorded in `member-http-validation.json`.

This does not expose login/enrolment endpoints, mount a network listener, change a live database, perform native passkey ceremonies or provide new process-kill measurements. It preserves the earlier requirement that every writer adopt fencing; old binaries and direct SQLite writers remain outside that boundary. Next connect the Swift wire contract to these routes, implement native assertion submission and recover an interrupted response via outcome before permitting another attempt. Kotlin Android remains the later phase.
