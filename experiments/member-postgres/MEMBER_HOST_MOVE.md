# Member host move

The authenticated member surface implements a local IOS-B21 host-move protocol. The source exports the current `NodeExport`, blind private-node records and the member recovery projection as one exact byte archive. The target validates the engine archive and its dependencies, preserves private record identities and revisions, imports completed recovery history, and refuses a move with an unresolved recovery ceremony. An engine import that reports any `left_behind` offer is rolled back because source authority cannot end while money remains tied to that host.

Private records are never decrypted by either host. The native member decrypts each source envelope and seals the same bytes for the configured target environment with a fresh nonce. The target accepts only the same ordered record identities, revisions and update times. The source remains usable after a corrupt archive, mismatched private record, incomplete engine import or any target failure.

An import receipt alone cannot retire the source. After durable target read-back, the target opens a WebAuthn ceremony bound to that exact receipt. Its resulting assertion names the target origin and relying party. The source verifies that proof against the household credential it already holds, then opens a second source-origin retirement ceremony bound to the complete target attestation. Successful retirement revokes every source credential and session for the household while retaining the source records as history.

The archive carries recovery configuration, completed or cancelled requests, owner logs and the public recovery keys they depend on. Pending or approved recovery refuses export. Recovery material is transported inside the authenticated archive but is not additionally wrapped to a target-host key; the member device is therefore part of this local transfer boundary.

## Limits

The integration suite provisions the same synthetic household key at two HTTPS origins to exercise the protocol. A real target still needs a supported cross-origin platform-passkey enrolment or migration path, trusted target configuration and stable operator routing. No deployed target directory, live device ceremony or routing switch is claimed by these tests.
