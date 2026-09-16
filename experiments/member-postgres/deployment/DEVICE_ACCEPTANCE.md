# Development device acceptance operator

This trusted CLI is not imported by the deployed API entry. It uses the existing dedicated development database, control-row fence and configuration binding. No migration, HTTP administration route or synthetic passkey is added. Preparation creates one random test principal with empty presenter grants and **no household**; it creates no offer or mandate ownership. A household's identifier is the name of the key its statements are signed with (§13.2, question 55), and on this service that key is the passkey the device registers, so the principal adopts its household at the `statement` step and not before.

Run from the service repository with the existing Vercel production-slot environment file. That slot belongs to the development-only project. Keep its contents private.

```sh
NEON_PROJECT_ID=young-pond-73223516 bun --env-file=/absolute/private/.env.production.local experiments/member-postgres/deployment/device-acceptance.ts status
NEON_PROJECT_ID=young-pond-73223516 bun --env-file=/absolute/private/.env.production.local experiments/member-postgres/deployment/device-acceptance.ts prepare
NEON_PROJECT_ID=young-pond-73223516 bun --env-file=/absolute/private/.env.production.local experiments/member-postgres/deployment/device-acceptance.ts invite /absolute/private/new-invitation.json
NEON_PROJECT_ID=young-pond-73223516 bun --env-file=/absolute/private/.env.production.local experiments/member-postgres/deployment/device-acceptance.ts statement
```

Run preparation once; a repeated preparation refuses. Status reports the existing identifiers, grants and active credential count, and the statement record once it exists. Invitation issuance checks the active principal, its household (still unclaimed at this point) and empty grants within the same locked unit. A change refuses issuance. The existing enrolment service issues a single-use invitation with the configured five-minute lifetime. Generate it only when the device is ready.

The output invitation file must not exist. Exclusive creation with mode 0600 refuses overwrite and symlink targets. The token is never printed on stdout. Supply it locally in the app's invitation field and delete the local file after use or expiry. Do not commit it, paste it into acceptance logs or send it to another person. If commit or file output fails, inspect status and expiry before an explicit fresh issuance; the CLI never retries automatically.

The isolated Neon verification test prepares the account, refuses a duplicate, completes synthetic registration through the public HTTP handler, refuses invitation replay, observes one credential, then refuses status/issuance after presenter grants change. This is service evidence only. Actual iPhone/iPad registration still requires the system credential UI and the user's verification.

## Statement approval acceptance

`statement` runs once, after the device has registered exactly one passkey. In one locked unit it registers a development presenter and merchant with ephemeral Ed25519 keys whose private halves are dropped, a signed catalogue with one physical product at 1,200 and a signed disclosure saying no goods ship and no payment is taken. It derives the household's identifier from the registered passkey's own P-256 public key, adopts it onto the principal once, registers that key under the household's name and imports the mandate `<household>.1` (a mandate has no key of its own, so nothing is registered under a mandate's name), creates and presents one physical box, records a delivery with carriage 550 and a collection marking the goods consumed. It grants the presenter, binds mandate and offer ownership, and binds the mandate to that credential.

The binding service derives its context from a live session, so the unit creates a session for the credential, binds, and revokes that session before commit. The token never leaves the unit. Changing the grant also revokes the device's current session, so the device signs in again before it sees the box.

Nothing here signs the statement. Approval still needs the native assertion from the registered passkey through `/member/statements/prepare` and `/member/operations/{id}/submit`. The settlement is an engine record in the development database; no provider is called and no money moves. A repeated `statement` refuses, and with zero or several active credentials it refuses before writing.

`statement-acceptance.test.ts` exercises this end to end on an isolated database: synthetic registration, the operator step, sign-in, list, statement read, prepare, submit and outcome. Two negative controls were run in disposable copies: removing the mandate binding and keeping the internal session live each make the test fail.

## Further boxes

**An acceptance prepared before 2026-09-16 has a free-name household and cannot adopt one.** `statement` refuses it with `Acceptance household is not this credential`, because that household is not the name of the passkey and nothing can sign for it. Start the acceptance again on a development database whose acceptance entries have been cleared; there is no in-place conversion, and there should not be, since the old household was a name the operator invented rather than a key.

`box` adds one more physical box under the mandate and credential binding that `statement` created, with the same price, carriage and consumed collection. It exists for device checks that need a fresh statement each time, such as an interrupted network or a relaunch after approval. A presenter may not offer a household the same product twice (§5.1), so each box registers its own presenter, merchant and one-product catalogue with ephemeral keys, and the grant moves to that presenter. Moving the grant revokes the device's session, so the device signs in again before it sees the box. It refuses unless the latest box has settled, so at most one statement waits at a time, and it refuses if the principal's grants have changed. Status reports the latest box.
