# Valence Engine

A reference implementation of the [Valence Protocol](https://github.com/atarasy/valence),
written so the [Ataraxia](https://github.com/atarasy/ataraxia) conformance
suites have something to run against.

**Digital binding only.** No inventory, no recovery, no redistribution, no
hardware. That is the whole of Stage 0 and it is deliberate: the physical
binding adds operations without adding anything the constitution needs tested.

**Not a product, and not the hub.** A member opens Atarasy. This is the engine
underneath an offer.

## What it is for

Two things, and no others.

1. Give the conformance suites a subject. Three of the five suites were written
   against it, and every probe in them has been shown to fail under a
   deliberate break of this code.
2. Find out which requirements the specification states but no component
   supplies. One was found on the first pass and is recorded below.

It holds everything in memory, has no persistence, no authentication and no
identity root. Do not deploy it.

## Running

```
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

MIT. The licence does not grant rights to the Ataraxia, Atarasy or Valence
names.
