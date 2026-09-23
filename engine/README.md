# Valence Engine

A reference implementation of the Valence Protocol, written so the
[Ataraxia](https://github.com/atarasy/ataraxia) conformance suites have
something to run against.

It lives beside the specification it implements, in `../SPEC.md`, because the
two change together: three corrections to the specification came out of writing
this, and each was made in the same pass as the code that found it.

**Both bindings, without the hardware.** The digital binding is complete. The
physical binding has its valences, its eligibility check, its recovery and its
loss deadline; what it does not have is a scanner, a route, or a temperature
log, which are operations rather than rules.

The physical half was built on 2026-09-09, when the Stage 0 replenishment
customer was decided as a type whose whole decision criterion is recovery in
item count. Until then it was out of scope on the ground that it adds
operations without adding anything the constitution needs tested. That was
true of the rules and false of the deadline: **an undecided physical candidate
must not become `returned` at expiry**, and nothing in the digital binding
says so.

**Not a product, and not the hub.** A member opens Atarasy. This is the engine
underneath an offer.

## What it is for

Two things, and no others.

1. Give the conformance suites a subject.
2. Find out which requirements the specification states but no component
   supplies. One was found on the first pass and is recorded below.

It holds everything in memory by default, has no authentication and no identity
root. Do not deploy it.

Setting `METER_BASE_URL` swaps the in-memory ledger for `MeterLedger`, which
speaks Meter's `authorize`, `commit` and `release` endpoints. That path has been
exercised against a stand-in reproducing Meter's measured behaviour, and never
against Meter itself.

## Running

```
cd engine
bun install
VALENCE_EXPLORATION_RATE=0.2 VALENCE_RECOVERY_GRACE_DAYS=3 VALENCE_RP_ID=localhost bun run src/server.ts
```

The rate has no default. §5 of the specification publishes no recommended
figure, and a default here would become one by accident, so the server refuses
to start without one.

## Running the unit tests

```
cd engine
bun test
```

No arguments and nothing to seed; this is `bun:test` running the specs under
`src/` in memory. There is no committed lockfile in this directory, so
`bun install` here resolves against whatever the pinned Bun version's registry
holds at install time rather than a fixed set of versions.

## Running the conformance suites

```
./scripts/conformance.sh
```

Starts the combined and separate-role servers, seeds their catalogues, and
runs the suites listed in `scripts/conformance.sh` from the ataraxia
repository. It looks for `ataraxia/tests` beside this repository's parent
(the side-by-side layout the top-level README asks for) and falls back to
`~/Documents/GitHub/ataraxia/tests` if no sibling checkout is there. Set
`ATARAXIA_TESTS` to point at the tests directory directly, overriding both.

It starts four servers, on 8788 and the next three hundreds (8888, 8988,
9088 by default; set `PORT` to move the first and the rest follow). 8788 is
also the default port of the local member API
(`experiments/member-postgres`), so stop that before running this, or set
`PORT` to a free one.

`conformance.sh` sets `VALENCE_BINDINGS=digital,physical`, so `HAS_PHYSICAL` is
true for this run and exactly one suite is skipped rather than run:
`binding: the physical binding is absent`, in `tests/binding/binding.test.ts`
(`describe.if(!HAS_PHYSICAL)`), which exists to cover a digital-only
deployment and is the mirror image of the binding this run has turned on.

## What this implementation found

**The reserve ceiling has no owner.** §6.4 requires that a settlement above the
reserved amount fails rather than quietly exceeding what the household
authorised. A reserve-and-commit ledger does not give you this. Measured
against Meter on 2026-09-08: a commit above the hold is charged as a
`usage_hold_adjustment` and succeeds, and it fails only when the balance cannot
cover the difference. **A funded household is exactly the case that slips
through.** The claim covers funded accounts and no others; an earlier draft
extended it to post-paid accounts inside their credit limit, which the code
does not do. The ceiling is enforced in `src/engine/ledger.ts` before anything is
delegated, and the specification now says so.

**A green suite can miss the break it exists for.** The first version of the
floor suite passed against an implementation demanding twice the declared
exploration rate, because every probe asked only whether an offer *below* the
floor was refused. The suite now asks the deployment for its rate and checks
the boundary from both sides.

**A breakdown is not a bill.** A settlement reported `kept_amount`,
`consumed_amount` and `lost_amount`, and the ledger took a fourth number nobody
could see. An implementation that added the lost amount to the charge passed
every probe, because everything it reported was true. §6 of the specification
now names a `charged` amount and requires it to equal the first two.

**A receipt with a resolvable identifier is a purchase history.** The engine
returned the lineage edge's id as the fact of receipt. An edge carries a product
and a merchant, so one route away from that identifier is the record clause 19
says a recipient does not acquire by receiving. The token is opaque now and
nothing resolves it.

## Structure

Four directories, split on 2026-09-09 so that the code says whose each part
is. The constitution binds them differently, and a flat directory made the
neutral registry look like a field on the person's side.

| Directory | Whose it is | What is in it |
|---|---|---|
| `src/engine/` | the presenter's, which anyone who presents runs | offers and the state machine, the exploration floor, expiry, settlement, the physical binding, the billing ledger |
| `src/hub/` | the person's, which a member opens | the approval surface, the permission ledger, mandates, recovery, the node's export |
| `src/shared/` | neither side's | the endpoint registry, and the canonical bytes for a lineage edge and a decided set |
| `src/common/` | plumbing | the domain types with the clause each shape answers to, the errors, and why an unknown field is refused rather than dropped |
| `src/http.ts` | the composition root | the §9 surface and the fixture routes, and the one place the three meet |

The default deployment presents both roles in one process. The conformance
harness also runs them separately. The engine asks the hub for mandates, the
day's total and delivery records, and reports decided offers and settlements
to the household's copy, as specified in §13.1 and §13.2.

## Licence

MIT, from the repository root. The licence does not grant rights to the
Ataraxia, Atarasy or Valence names.
