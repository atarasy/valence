# Authenticated mandate changes

The PostgreSQL member service exposes the effective mandate and a durable, version-bound change ceremony for Atarasy Dials.

- `GET /member/mandates/effective` lists the authenticated household's effective records, including a lapsed record that may need renewal.
- `GET /member/mandates/changes` lists at most the 100 newest changes visible to the authenticated household as owner or required co-signer.
- `POST /member/mandates/changes` accepts exactly `{mandate}`. The proposal must follow the current effective version and keeps a fixed before/after pair.
- `GET /member/mandates/changes/:id/prepare` gives a required signer the challenge and only that principal's active credential.
- `POST /member/mandates/changes/:id/submit` accepts exactly `{assertion}`. Each signer signs the same `valence.mandate.2` bytes. The engine records the version only after all required assertions verify.
- `POST /member/mandates/changes/:id/cancel` accepts `{}` and is available only to the owning household while the change is pending.

A tightening requires the household. A loosening requires the household and every co-signer named by the previous effective version. An empty prior co-signer list therefore invents no additional signer. A stale base version becomes `stale`; a competing proposal returns `409 change_pending`; malformed protections return a bounded `422` refusal. Responses never expose retained assertion bytes.

The PostgreSQL HTTP test uses two independently enrolled passkeys. It records a tightening that adds a co-signer, proves that a later widening remains pending after the household signs, lets the named co-signer discover and sign the fixed proposal, and reads back the new effective version. It also checks stale, competing and overlong-cooling refusals. No hosted database or real member identity is used.
