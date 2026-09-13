# Atomic local HTTP composition

## Behaviour

`openLocalHTTP(path, policy).fetch(request)` is an internal Request/Response harness over the existing reference router. It opens no listener and adds no routes. Each request constructs a fresh engine, local ledger, registry, recovery register, approval desk, permission ledger and delivery register in one unified transaction. Mandates/day remain local engine sources. Registry membership is derived from the same locked view. Existing shared member modules can use the same database boundary, but this harness does not add their HTTP routes.

Request bodies are read with an explicit byte bound before taking the lock. Admission includes body readers and queued work, with a configured pending limit. Excess/closed requests return 503. Fully buffered requests enter a serial queue; readiness order, not client arrival order, determines its order. Other instances coordinate through the database lock. Closing while admitted work remains is refused. The origin must match deployment policy. Unknown policy fields, including remote-provider options, are refused.

The existing router catches exceptions and returns HTTP error responses. The wrapper materialises those responses, throws them through the unit to force rollback, then returns them outside the transaction. Only 2xx responses commit. Response bodies are bounded and copied before commit; response-limit failures roll back even if a handler produced a successful write. Successful bytes reach the caller after commit. An exception outside the router returns a generic 500; existing router error responses retain their reference error body.

## Verified through the request boundary

Tests exercise real reference handlers: note creation and duplicate refusal, partial node-import rollback, expiry persistence during GET, response-limit rollback, same-instance and cross-instance request concurrency, admission pressure during an unfinished body, close refusal, oversized/foreign-origin requests, database-write failure, and local settlement with exact repeated receipt and a single daily entry. Negative controls remove error-response rollback or the response limit and cause the respective test to fail.

These are in-process Request/Response calls, not network transport or native-device tests. Existing process-kill tests remain regression coverage only. No engine source or mutation corpus was changed in this increment.

## Remaining boundaries

This harness is not a secured member API. It preserves reference routes, including provisioning and import capabilities, and must not be mounted as a public member server. There is no transport/body deadline, member authentication, rate limiting by principal or proxy/TLS policy. A stalled body occupies one bounded admission slot but holds no database lock. Cancellation before queue admission is checked; once an operation is queued, a caller disconnect is not a rollback guarantee, so later transport integration must preserve outcome reconciliation.

Atomic import is not semantic import validation. The reference import still needs full staged schema, ownership, collision and cross-record checks before it is suitable for adopting existing data. The existing standalone server has not switched stores. This increment does not enable remote sources, mutate old files, migrate member credentials or connect Swift signing.

Next: specify and implement a strict staged local import contract; test namespace/scope conflicts, cross-record mismatches, unknown fields, duplicate IDs and exact exported receipt history. Rehearse migration into a newly created isolated file, verify source/destination exports and a failed-import rollback, and only then define explicit cutover. The member prepare/submit/outcome surface and Swift integration follow those checks. Android remains a later phase.
