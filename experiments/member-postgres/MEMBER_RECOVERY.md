# Member recovery ceremony

The member runtime stores the host half of a recovery construction without storing the ledger key. The native owner divides its 256-bit ledger key into three 64-byte participant shares. A device, the named recoverer and the host each receive one share; any two distinct shares reconstruct the key, while any one participant lacks a uniformly random component.

The recoverer share is an opaque P-256 ECDH, HKDF-SHA256 and AES-256-GCM packet for the recoverer's recovery-only public key. The host stores that packet, its own opaque share, the ledger-key digest and an opaque independent-notice channel token. It cannot open the packet. The recoverer never receives the host share or the key digest.

## Ceremony

Recovery-key registration, configuration and approval each use a fresh, expiring server preparation bound to the current session credential and an exact WebAuthn challenge. The assertion must use that one credential. Preparations are single-use, scoped to the household and operation kind, and survive only until their expiry.

The owner starts a request with a new P-256 public key. The request snapshots the current epoch, host share, recoverer packet, ledger-key digest and notice channel, so later configuration changes cannot silently change an existing ceremony. A configuration change cancels nonterminal requests from the old epoch; completed history remains readable.

The named recoverer opens only its encrypted share, encrypts it to the requester's public key and signs the exact release. Approval first writes the durable recovery log in `notice_pending`. Owner reads still hide the release, host share and key digest at that point.

`deliverRecoveryNotices` is a trusted worker method and has no HTTP route. Its notifier must treat the notice UUID as an idempotency key, resolve the opaque channel token to all required registered destinations, include at least one destination outside the recoverer's control, and return a bounded receipt only after the provider accepts delivery. Only then does the runtime atomically acknowledge the log and expose the two recovery materials to the owner. A delivery error leaves the request approved, the log pending and the host share hidden for a later retry.

The member bearer can list its role-filtered requests and the owner can export the recovery log. A recoverer is a ceremony participant, not a standing grantee: the recovery API provides no private-node record route or everyday data key.

## Limits

The local integration tests use a synthetic notifier to prove the release gate, failure retry, restart durability, foreign-role refusal and configuration rotation. The fixture exported for Atarasy contains public ceremony responses and opaque ciphertext only; it excludes bearer tokens, assertions, private keys and live destinations.

No independent delivery provider or registered-channel directory is connected to the deployed entry. Consequently, this implements and tests the service boundary but does not establish deployed IOS-B20 acceptance. Provider idempotency, multi-channel fan-out, real-device passkeys and delivery evidence remain separate gates.
