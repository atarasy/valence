# Production deployment

The member API has two hosted targets. They are built from the same code and differ in four values, all fixed in `targets.ts`:

| | development | production |
|---|---|---|
| Origin and relying party | `https://api-dev.vox.delivery` | `https://members.vox.delivery` |
| Deployment id (`identity.ts`) | `atarasy_api_dev_2` | `atarasy_api_prod` |
| Neon project | `young-pond-73223516` | `weathered-violet-85512339` (Vercel-managed, `aws-ap-southeast-1`) |
| Vercel project | `voxtech/atarasy-api-dev` | `atarasy-api` (`prj_sxVkImnskRS6ExTRLYkWxWYnkBEg`, team `team_jj6IfQQOAkn228T4uamrSFkh`) |
| AASA `webcredentials` | `83W4J65UE6.dev.atarasy.prototype` | `83W4J65UE6.com.vox.atarasy` |

Every other runtime value in `production/config.json` equals the development one, including the five-minute ceremony and operation lifetime (`maximumLifetimeMs`), the fourteen-day invitation lifetime (`invitationLifetimeMs`, 1,209,600,000 ms) and the empty Android allow-list.

**Production and development share no data, no credentials and no passkeys.** They are separate Neon projects, their deployment ids differ, and their relying parties differ, so a passkey made on one can never assert to the other. A member of one is not a member of the other.

## The guard

Every command that connects takes its target explicitly and checks it twice before writing anything.

1. **The label.** `NEON_PROJECT_ID` must equal the target's project id, or the command stops before connecting. The development commands that existed before this file (`bootstrap.ts` with no flag, `device-acceptance.ts`, `presenter-credential.ts`) still require `young-pond-73223516`, so none of them runs against production.
2. **The database.** `bootstrap.ts`, `member-invite.ts` and `review-proposal.ts` then read `atarasy_member.control` and refuse if it already holds a deployment scoped to the other target's environment. This is what catches an environment file whose label and connection string came from different places. A database with no control table yet passes.

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

It provisions one new principal, unclaimed and with no presenter grants, records it as a review principal, and issues one single-use invitation through the ordinary enrolment service, valid for fourteen days. The passkey is created on the reviewer's device when the invitation is used; this command makes no credential, household, mandate or offer. It has no `--target` and refuses unless both halves of the guard say production. The code to give App Review is the `token` in the file.

**6. Nothing else to run.** Everything after the invitation happens on the reviewer's own steps, at whatever hour they take them (next section). `review-proposal.ts` is the fallback if a proposal is ever missing:

```sh
NEON_PROJECT_ID=weathered-violet-85512339 bun --env-file=/absolute/private/atarasy-api.env deployment/review-proposal.ts propose <household, key:...>
```

It takes the household a review principal adopted (`/auth/session` names it, or `member_review_proposals`). Before that household has signed its version-1 mandate it answers `{"awaitingSignature":true,"claimHeld":true}` and writes nothing; after, it presents the proposal if the signing request did not, and answers `presented:false` with the existing offer if it did. It refuses a household no review principal adopted (`Not a review household; the reviewer has to sign in once first`), never adopts a household and never signs anything.

## Households are adopted at the first sign-in

Decided 2026-09-23, in every environment. A household is the name of its key (question 55), and the first moment the service knows a member holds that key is the first sign-in whose assertion verifies. So `login.finish` calls `member-adoption.ts` after the assertion verifies and **before the session is created**:

- if the credential's principal has no household, it adopts the one named by that credential's key, registers the key under that name in the engine, and writes the version-1 mandate as a **claim** (`<household>.1`);
- registration alone adopts nothing, because enrolment runs with attestation `none` and a registered key is a value the client sent;
- a household another live principal already holds is refused, and so is the sign-in (401); the refusal writes nothing of the adoption;
- a later sign-in changes nothing.

The server never signs the claim. It has no effect until the member's own passkey signs it through `/member/mandates/prepare` and `/submit`, which is the same ceremony a moved mandate uses, and the app shows every term before it asks. Its defaults (`member-adoption.ts`, `firstMandateClaim`):

| Field | Value | Reason |
|---|---|---|
| `ceiling_out_of_network` | 0 | The tightest value the shape allows, because the member did not choose it. On this service it bounds nothing today (no registry is supplied, so every merchant reads as in network); it matters the day a registry exists, and then it means nothing is bought from outside the network until the member raises it, which they can do alone because the claim names no co-signer |
| `ceiling_daily` | none | Any figure would be the host's guess at a member's spending, set before they have spent anything. The widest value the shape allows is what it needs: a ceiling is the member's to set in the app, and tightening needs nobody else |
| `cooling_seconds` | none | A cooling window delays every settlement the member signs. The host has no ground to impose a delay the member did not ask for; the member can add one alone |
| `co_signers` | none | A co-signer is a person's key. The host holds nobody's key and cannot name a person on the member's behalf |
| `lapses_at` | 365 days after adoption | A standing mandate lapses unless renewed (clause 58). A year is a round period inside the engine's 400-day bound; the member renews by signing again |
| `version` | 1 | The first version |

The development device-acceptance commands follow: `statement` uses the household the sign-in adopted rather than adopting one (it still adopts for a principal that signed in before this change), and its box is signed under these terms, so its out-of-network ceiling is now 0 rather than the box's price, which a refutation pass had already measured to bound nothing. `retire` undoes an enrolment whose sign-in adopted a household by revoking the credentials, disabling that principal and preparing a fresh one, because adoption has no route back. `local-household.ts` is unchanged: it never signs in.

## What the App Reviewer sees

The review principal is granted the review shop **at the sign-in that adopts its household**, before the session exists, so no grant change revokes the reviewer's session later. Signing the version-1 mandate presents the proposal **in the same request** (`review-shop.ts`, `presentAfterSigning`): the review shop (`app_review_shop`, merchant `app_review_merchant`, registered once per deployment with ephemeral keys dropped after signing its catalogue and disclosure) makes one digital proposal of three goods, `green_tea_50g` at 800, `cotton_hand_towel` at 1,200 and `beeswax_candle` at 1,500, open for 30 days, with a carriage quote of 0. The digital binding ships nothing and no provider is called, so a decision on it is an engine record and no money moves. An ordinary member is untouched: no grant at sign-in, nothing presented when they sign.

The steps, with the labels the iOS app shows (`atarasy` `ios/AtarasyPrototype`, read 2026-09-23, not yet run against production):

1. Member account, "Join with an invitation": paste the code into **Invitation** and tap **Register a passkey**; create the passkey. The app says "Passkey registered. Sign in to open your session."
2. Tap **Sign in with a passkey**. The household is adopted here and the review shop granted.
3. Under "Mandates awaiting your signature", tap **Refresh unsigned mandates**, then **Review mandate · version 1**, then **Load terms for review**. The terms are shown; switch on **I have read and agree to these terms** and tap **Sign mandate with a passkey**. The app says "Mandate signed."
4. The proposal from `app_review_shop` is now in the proposals section of the same screen, in the same session, with no second sign-in. Choose keep or return for each item and approve with the passkey.

Whether the proposals section refreshes on its own after step 3, and the label of its refresh control if it does not, has not been checked on a device.

`review-proposal.test.ts` runs this on a disposable database: an ordinary member beside the reviewer, the grant at sign-in, the fallback answering `awaitingSignature`, the signature presenting the proposal in the same request, the same session listing and reading it, a signed decision committing with carriage 0, and the ordinary member signing its own claim with nothing granted or presented. `member-adoption.test.ts` covers adoption itself. Each of these was watched failing with its rule removed: the sign-in hook, the held-elsewhere refusal, the review-principal check, the grant at adoption, the presentation after signing and the invitation lifetime.

## Static pages

The production entry serves `GET /privacy` and `GET /support` as `text/html` with status 200 and no redirect, answered before the database is opened, in the same way as the AASA. They are `production/privacy.html` and `production/support.html`, built into the bundle as text. The privacy text is the draft in the vault's `Projects/Atarasy/files/App_Store_Submission_2026-09-23.md` §4 as it stood on 2026-09-23, after the founder supplied the date, address, representative, contact address and transfers paragraph; that draft says it has not been read by a lawyer. The support page gives the same contact address. Changing either file changes the bundle and its manifest, so rebuild and redeploy; the runtime configuration and its fingerprint do not change.

## The development deployment after this change

`invitationLifetimeMs` changed the runtime configuration's shape, so the profile moved from `atarasy.member-runtime.2` to `.3` and the fingerprint changed. **`api-dev.vox.delivery` refuses every request with `Bound runtime mismatch` (503) from the moment a build of this code serves until its stored binding is moved forward**, which is what #41 measured. The order for the development deployment:

1. Write a rebind plan outside the repository: `{"identity":{"id":"atarasy_api_dev_2","environment":"development","origin":"https://api-dev.vox.delivery","epoch":1},"config":<deployment/config.json as committed>}`.
2. Build the new bundle first (`bun deployment/build.ts /tmp/atarasy-api-dev-<stamp>`), so promotion can follow the rebind at once.
3. `ATARASY_MIGRATION_SOURCE_URL=<development DATABASE_URL_UNPOOLED> bun rebind-runtime.ts /secure/rebind-plan.json` (dry run: expect `from .2`, `to .3`, `differing: ["invitationLifetimeMs"]`), then the same with `--write`.
4. Promote the new build immediately: after `--write` the old build refuses every request, so the gap between the two is the outage.

`rebind-runtime.ts` allows exactly this transition, adding only `invitationLifetimeMs` at 1,209,600,000; every other key must already match. A deployment still bound to `.1` is refused, because a plan is always read as `.3`. Production needs none of this: `bootstrap.ts` binds it under `.3` from the start.

## What stays development-only

`device-acceptance.ts` and `presenter-credential.ts` refuse production. Device acceptance seeds presenters, catalogues and boxes and writes an unsigned mandate claim for the device to sign, which must never happen to a real member.
