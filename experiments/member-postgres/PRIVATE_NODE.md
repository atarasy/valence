# Blind private-node records

The authenticated member runtime stores bounded opaque records for the native private node. The host owns availability, household isolation, revision ordering and durable ciphertext storage. It never receives an envelope key or a plaintext record.

## HTTP profile

- `GET /member/private-node/records` lists the current session household's envelopes.
- `GET /member/private-node/records/:uuid` reads one owned envelope.
- `POST /member/private-node/records/:uuid` accepts exactly `{expectedRevision,envelope}`.
- The envelope is exactly `{profile:"atarasy.private-node-record.1",nonce,ciphertext}`. The nonce is 12 bytes and ciphertext is an authenticated-encryption payload of at most 12,288 plaintext bytes plus a 16-byte tag.
- Creation expects revision zero. Every replacement compares the exact current revision and increments it once. A stale writer receives `409 private_record_conflict`.

The bearer session supplies the household. A request cannot supply an owner, plaintext kind, index field, key, recovery share or arbitrary metadata. Database rows use an owner digest for isolation and contain no raw household identifier. Record identifiers, revision, update time, ciphertext length and access traffic remain visible to the host.

The service cannot prove that arbitrary bytes came from a conforming encrypting client. The official native client uses AES-256-GCM with a fresh 12-byte nonce and authenticated scope containing the profile, environment, origin, household, record identifier and next revision. Host storage and logs alone have no key with which to open those records.

Tests cover authenticated create/read/list/update, stale compare-and-swap, restart, foreign household isolation, credential revocation, exact schemas, size and nonce bounds, database rollback and absence of plaintext/raw household fields. The generated fixture is decrypted independently by Atarasy Swift CryptoKit.

This is the storage and device-loss prerequisite for IOS-B19. It does not implement the 2-of-3 recovery share ceremony, independent recovery notice or host migration; those remain IOS-B20 and IOS-B21.
