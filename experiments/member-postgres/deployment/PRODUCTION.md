# Production deployment

The member API has two hosted targets. They are built from the same code and differ in four values, all fixed in `targets.ts`:

| | development | production |
|---|---|---|
| Origin and relying party | `https://api-dev.vox.delivery` | `https://members.vox.delivery` |
| Deployment id (`identity.ts`) | `atarasy_api_dev_2` | `atarasy_api_prod` |
| Neon project | `young-pond-73223516` | `weathered-violet-85512339` (Vercel-managed, `aws-ap-southeast-1`) |
| Vercel project | `voxtech/atarasy-api-dev` | `atarasy-api` (`prj_sxVkImnskRS6ExTRLYkWxWYnkBEg`, team `team_jj6IfQQOAkn228T4uamrSFkh`) |
| AASA `webcredentials` | `83W4J65UE6.dev.atarasy.prototype` | `83W4J65UE6.com.vox.atarasy` |

Every other runtime value in `production/config.json` equals the development one, including the five-minute ceremony and invitation lifetime and the empty Android allow-list.

**Production and development share no data, no credentials and no passkeys.** They are separate Neon projects, their deployment ids differ, and their relying parties differ, so a passkey made on one can never assert to the other. A member of one is not a member of the other.

## The guard

Every command that connects takes its target explicitly and checks it twice before writing anything.

1. **The label.** `NEON_PROJECT_ID` must equal the target's project id, or the command stops before connecting. The development commands that existed before this file (`bootstrap.ts` with no flag, `device-acceptance.ts`, `presenter-credential.ts`) still require `young-pond-73223516`, so none of them runs against production.
2. **The database.** `bootstrap.ts` and `member-invite.ts` then read `atarasy_member.control` and refuse if it already holds a deployment scoped to the other target's environment. This is what catches an environment file whose label and connection string came from different places. A database with no control table yet passes.

`targets.test.ts` and `member-invite.test.ts` prove both halves in both directions on disposable local databases, and each was watched failing with its guard removed.

## Order

Run from `experiments/member-postgres`, with the production project's environment file (`DATABASE_URL`, `DATABASE_URL_UNPOOLED`) at a private absolute path. Check that `DATABASE_URL_UNPOOLED` holds a connection string and not `[SENSITIVE]` before using it. Keep the file private.

**1. Create the schema and the deployment identity.** Applies the tracked migrations over the direct connection, writes the `atarasy_api_prod` control row and binds the production runtime configuration. It provisions no member.

```sh
NEON_PROJECT_ID=weathered-violet-85512339 bun --env-file=/absolute/private/atarasy-api.env deployment/bootstrap.ts --target production
```

This must run before the first deploy: the bundle refuses every request until its control row exists.

**2. Build** into a directory that does not exist yet. The build refuses an existing one.

```sh
bun deployment/build.ts --target production /tmp/atarasy-api-<yyyymmdd-hhmm>
test -s /tmp/atarasy-api-<yyyymmdd-hhmm>/api/index.js
```

The line printed ends `(production, https://members.vox.delivery)`. A failed build leaves a directory without `api/index.js`, which deploys and answers 404 on every route, so do not skip the `test`.

**3. Deploy** without linking inside the output directory, so the runtime manifest's inventory stays exact.

```sh
VERCEL_ORG_ID=team_jj6IfQQOAkn228T4uamrSFkh VERCEL_PROJECT_ID=prj_sxVkImnskRS6ExTRLYkWxWYnkBEg vercel deploy --prod /tmp/atarasy-api-<yyyymmdd-hhmm>
```

`members.vox.delivery` must already be attached to the project. The entry answers 403 to any other origin, so the `*.vercel.app` URL is not a check.

**4. Check.**

```sh
curl -si https://members.vox.delivery/.well-known/apple-app-site-association   # 200, application/json, apps ["83W4J65UE6.com.vox.atarasy"], no redirect
curl -si https://members.vox.delivery/auth/session                             # 401
```

**5. Issue the App Review invitation.**

```sh
NEON_PROJECT_ID=weathered-violet-85512339 bun --env-file=/absolute/private/atarasy-api.env deployment/member-invite.ts issue /absolute/private/review-invitation.json
```

It provisions one new principal, unclaimed and with no presenter grants, and issues one single-use invitation through the ordinary enrolment service. The passkey is created on the reviewer's device when the invitation is used; this command makes no credential, household, mandate or offer. It has no `--target` and refuses unless both halves of the guard say production.

**The principal has no household after enrolment, and nothing over HTTP gives it one.** A household is the name of its key (question 55), and the only code that adopts one is the development acceptance step and the local fixture. An unclaimed principal can sign in and log out, but `/auth/session` answers 401 to it (`statement-acceptance.test.ts`), so every member read refuses until a household is adopted.

The output file is created exclusively with mode 0600 and holds `{origin, token, expiresAt}`. The token is never printed; stdout names the principal and the expiry. The invitation expires `maximumLifetimeMs` after issue, which is **five minutes**, so issue it only when the reviewer is ready, and issue again for a new principal once it is spent or expired. Nothing is retried automatically. Do not commit the file, paste the token into a log or send it anywhere other than to the reviewer.

## What stays development-only

`device-acceptance.ts` and `presenter-credential.ts` refuse production. Device acceptance seeds presenters, catalogues and boxes and writes an unsigned mandate claim for the device to sign, which must never happen to a real member.
