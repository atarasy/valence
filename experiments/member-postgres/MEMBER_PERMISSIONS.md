# Authenticated permission history and revocation

`GET /member/permissions/list` uses the bearer session's verified household. It returns `{household, checkedAt, permissions}` including active, expired and revoked records. A client must derive current status from expiry and revocation, not infer that every listed row permits access. The existing permission ledger enforces expiry at the point of access.

`POST /member/permissions/revoke` accepts exactly `{permission: <UUID>}`. It revokes only that household's matching row. Repeated requests return the original revoked record and timestamp, so response loss does not require a new operation or change history. Other grants are preserved. The response is `{household, permission}`. Both routes are no-store, use the existing admission budget and transaction boundary, reject query parameters and enforce their methods. Foreign identifiers and unavailable/revoked sessions produce the existing generic refusal. The caller cannot supply a household.

Revocation is an authenticated reduction of access; it creates no grant and invokes no payment provider. The reference ledger's full history remains exportable. A database failure rolls back revocation and allows an exact later retry. Clients should read the list after an uncertain response and require a separate explicit action before another request.

This does not expose the reference engine's unauthenticated permission mutation routes. New grants still require action-specific review, narrow fields, purpose, requesting party, expiry and cancellation that grants nothing. The native list/revoke screen is implemented in Atarasy 4e16c85; the authenticated frozen-request flow is described below. Native new-grant review remains to be connected. UI copy must use meaningful labels and not model identifiers as its primary explanation.

Synthetic HTTP tests cover two valid households, one-grant revocation, exact retry after independent composition, malformed requests, credential revocation, expiry enforcement and a database-trigger failure. `ATARASY_PERMISSION_FIXTURE_OUTPUT`, when explicitly set for the test, writes only public synthetic response shapes for native integration, with exclusive creation and mode 0600. It contains no bearer token or private key.

## Frozen action requests

`openPermissionRequests(runtime).issueDuplicateCheck(...)` is a trusted, transaction-scoped issuer. It freezes household, action description, requester identity/display name, purpose, review expiry and access expiry. Its only supported field is `duplicate_check` ("Whether you already have a product"). It cannot grant arbitrary fields. There is no HTTP route to create requests, and no implicit or settings-wide grant. A real trusted action producer and requester directory still need to be connected; supplied names are not an assertion of external identity verification.

Authenticated member routes:

- `GET /member/permissions/requests`: own requests, including retained outcomes and expired requests.
- `GET /member/permissions/requests/:uuid`: frozen terms, digest, current state and outcome.
- `POST /member/permissions/requests/:uuid/grant` or `/cancel`: exactly `{digest}` matching the displayed review. The client cannot replace any terms.

Request state and permission ledger mutation commit in one PostgreSQL transaction. Concurrent identical grants return the same permission, never another grant. Cancellation is terminal and grants nothing. An expired pending review cannot grant. Opposite decisions after either terminal outcome are refused. On a lost response, GET reads the retained result; an exact retry is also idempotent. Repeating a grant after its permission has been revoked returns that same revoked row and does not re-enable it. Valid session ownership is checked on every read and mutation, including retries. These routes use the existing admission, writer-fencing and no-store boundary.

The digest binds displayed terms; it is not a passkey signature or evidence that a human read them. Native review integration, verified requester naming, actual action entry/producer and real-device acceptance remain open. The reference engine's unauthenticated grant route is still not exposed by the member service.
