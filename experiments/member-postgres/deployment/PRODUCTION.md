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
curl -si https://members.vox.delivery/privacy                                  # 200 text/html
curl -si https://members.vox.delivery/support                                  # 200 text/html
```

**5. Issue the App Review invitation.**

```sh
NEON_PROJECT_ID=weathered-violet-85512339 bun --env-file=/absolute/private/atarasy-api.env deployment/member-invite.ts issue /absolute/private/review-invitation.json
```

It provisions one new principal, unclaimed and with no presenter grants, and issues one single-use invitation through the ordinary enrolment service. The passkey is created on the reviewer's device when the invitation is used; this command makes no credential, household, mandate or offer. It has no `--target` and refuses unless both halves of the guard say production.

**6. Put a proposal in front of the reviewer.** Run twice, with the principal `member-invite.ts` printed, after the reviewer's device has enrolled and signed in once.

```sh
NEON_PROJECT_ID=weathered-violet-85512339 bun --env-file=/absolute/private/atarasy-api.env deployment/review-proposal.ts propose review_member_<32 hex>
```

The first run adopts the principal's household from its one signed-in passkey, because a household is the name of its key (question 55) and nothing over HTTP adopts one; until then the reviewer can sign in but `/auth/session` answers 401 (`statement-acceptance.test.ts`). It writes the household's mandate as a claim and prints `awaitingSignature: true`. **The reviewer's device then signs the claim** (`/member/mandates/list`, `/prepare`, `/submit`): nobody else can, and an offer cannot name a claim. The second run registers the review shop once per deployment (`app_review_shop`, merchant `app_review_merchant`, ephemeral keys dropped after signing the catalogue and disclosure), grants it to the principal and presents one digital proposal of three goods (`green_tea_50g` 800, `cotton_hand_towel` 1,200, `beeswax_candle` 1,500), open for 30 days under a mandate that lapses in 90. The carriage quote is 0 and the digital binding ships nothing; no provider is called and no money moves. Changing the grant ends the reviewer's session, so the device signs in again before it sees the proposal.

It refuses a principal `member-invite.ts` did not issue, a credential count other than exactly one signed-in passkey, and a second proposal to the same principal. It prints the household, mandate, presenter and offer identifiers and nothing secret.

`review-proposal.test.ts` runs this end to end on a disposable database: enrolment, both refusals before sign-in, the claim, the device's mandate signature, the proposal, the list and detail reads, and a signed decision that commits with carriage 0. Removing the review-principal check, the grant, the mandate binding, the carriage quote or the deliberation each makes it fail.

## Static pages

The production entry serves `GET /privacy` and `GET /support` as `text/html` with status 200 and no redirect, answered before the database is opened, in the same way as the AASA. They are `production/privacy.html` and `production/support.html`, built into the bundle as text. The privacy text is the draft in the vault's `Projects/Atarasy/files/App_Store_Submission_2026-09-23.md` §4, and **its bracketed placeholders ([date], [address], [name], [email] and the transfers paragraph) are still visible and must be filled before submission.** Changing either file changes the bundle and its manifest, so rebuild and redeploy; the runtime configuration and its fingerprint do not change.

## What stays development-only

`device-acceptance.ts` and `presenter-credential.ts` refuse production. Device acceptance seeds presenters, catalogues and boxes and writes an unsigned mandate claim for the device to sign, which must never happen to a real member.
