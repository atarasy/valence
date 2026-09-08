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

1. Give the conformance suites a subject. Six of the seven suites were written
   against it, and every probe in them has been shown to fail under a
   deliberate break of this code.
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
VALENCE_EXPLORATION_RATE=0.2 bun run src/server.ts
```

The rate has no default. §5 of the specification publishes no recommended
figure, and a default here would become one by accident, so the server refuses
to start without one.

## Running the conformance suites

```
./scripts/conformance.sh
```

Starts the server, seeds a catalogue, and runs the `absence`, `floor` and
`silence` suites from the ataraxia repository. Set `ATARAXIA_TESTS` if that
repository is not beside this one.

## Checking that the tests can fail

```
./scripts/mutate.sh no_floor python3 scripts/mutations/no_floor.py
```

Applies one break, runs the suites, prints what failed, and restores. The
seventeen mutations in `scripts/mutations/` are the ones the ledger in
`ataraxia/tests/MUTATIONS.md` records. A probe that stays green under its
mutation is not a probe, and this is how that is found out rather than assumed.

## What this implementation found

**The reserve ceiling has no owner.** §6.4 requires that a settlement above the
reserved amount fails rather than quietly exceeding what the household
authorised. A reserve-and-commit ledger does not give you this. Measured
against Meter on 2026-09-08: a commit above the hold is charged as a
`usage_hold_adjustment` and succeeds, and it fails only when the balance cannot
cover the difference. **A funded household is exactly the case that slips
through.** The claim covers funded accounts and no others; an earlier draft
extended it to post-paid accounts inside their credit limit, which the code
does not do. The ceiling is enforced in `src/ledger.ts` before anything is
delegated, and the specification now says so.

**A green suite can miss the mutation it exists for.** The first version of the
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

| File | What is in it |
|---|---|
| `src/types.ts` | the domain, with the clause each shape answers to |
| `src/engine.ts` | the state machine, the floor, expiry, settlement, lineage |
| `src/ledger.ts` | the reserve-and-commit port, and the ceiling |
| `src/lineage.ts` | the bytes a giver signs |
| `src/validate.ts` | why an unknown field is refused rather than dropped |
| `src/http.ts` | the §9 surface, and nothing else |

## Licence

MIT, from the repository root. The licence does not grant rights to the
Ataraxia, Atarasy or Valence names.
