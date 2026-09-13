# Development device acceptance operator

This trusted CLI is not imported by the deployed API entry. It uses the existing dedicated development database, control-row fence and configuration binding. No migration, HTTP administration route or synthetic passkey is added. Preparation creates one random test principal and household with empty presenter grants; it creates no offer or mandate ownership.

Run from the service repository with the existing Vercel production-slot environment file. That slot belongs to the development-only project. Keep its contents private.

```sh
NEON_PROJECT_ID=young-pond-73223516 bun --env-file=/absolute/private/.env.production.local experiments/member-postgres/deployment/device-acceptance.ts status
NEON_PROJECT_ID=young-pond-73223516 bun --env-file=/absolute/private/.env.production.local experiments/member-postgres/deployment/device-acceptance.ts prepare
NEON_PROJECT_ID=young-pond-73223516 bun --env-file=/absolute/private/.env.production.local experiments/member-postgres/deployment/device-acceptance.ts invite /absolute/private/new-invitation.json
```

Run preparation once; a repeated preparation refuses. Status reports the existing identifiers, empty grants and active credential count. Invitation issuance checks the active principal, original household and empty grants within the same locked unit. A change refuses issuance. The existing enrolment service issues a single-use invitation with the configured five-minute lifetime. Generate it only when the device is ready.

The output invitation file must not exist. Exclusive creation with mode 0600 refuses overwrite and symlink targets. The token is never printed on stdout. Supply it locally in the app's invitation field and delete the local file after use or expiry. Do not commit it, paste it into acceptance logs or send it to another person. If commit or file output fails, inspect status and expiry before an explicit fresh issuance; the CLI never retries automatically.

The isolated Neon verification test prepares the account, refuses a duplicate, completes synthetic registration through the public HTTP handler, refuses invitation replay, observes one credential, then refuses status/issuance after presenter grants change. This is service evidence only. Actual iPhone/iPad registration still requires the system credential UI and the user's verification.
