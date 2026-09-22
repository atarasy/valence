# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this repository is

A reference implementation of the Valence Protocol, written so the Ataraxia
conformance suites have a subject. Bun and TypeScript, no dependencies beyond
type definitions, everything in memory.

**It carried the digital binding only until 2026-09-12**, when the box was
built: `src/engine/physical.ts`, the collection, the settlement statement a
household signs, the delivery register and the carriage. A deployment may
still run digital-only, and the suites read `HAS_PHYSICAL` to decide what to
ask, so the two are a configuration rather than two implementations.

It sits inside the specification's own repository, under `engine/`. That is
deliberate and it is the arrangement the constitution's README already
described: three names, and the engine is part of Valence rather than a fourth
thing. The cost of the arrangement is that a change here looks like a change to
the specification, so read the next section before making one.

**All documents and code here are in English.**

| Related | What |
|---|---|
| `../SPEC.md` | the specification. Section numbers in comments refer to it |
| `~/Documents/GitHub/ataraxia` | the constitution and the conformance suites this is run against |
| `~/Documents/GitHub/hacci/Projects/Atarasy/` | the private Japanese strategy documents, where decisions are made |

Change flows one way: **decide in the vault, specify in `../SPEC.md`, implement
here.** Sharing a repository does not make the two halves equal. A change here
that would make the specification false is a change to the specification that
has not been written yet, and a design decision made only in `engine/` will be
lost. What
belongs here instead is the opposite direction: a requirement the specification
states that turns out to have no owner. Record those, and open a correction in
`valence`.

## The rule that governs the tests

**A test that cannot fail is not a test.** Watch a new probe fail against the
behaviour it exists to refuse before trusting it green.

Mutation testing (the `scripts/mutations/` corpus, `mutate.sh`, the sweep and
the `MUTATIONS.md` ledger) was removed on 2026-09-22 by the founder's decision.
Notes in the suites that name a mutation are historical and point at nothing.

## Things that will be tempting and are wrong

**Giving `explorationRate` a default.** The constructor refuses without one on
purpose. The specification publishes no recommended figure because publishing
one before any deployment exists makes it a standard by accident, and a default
in the reference implementation is exactly that.

**Dropping unknown request fields.** `validate.ts` refuses them. This is the
mechanism behind §3.3: a caller that sends a discount and receives a 201 has
been told the field exists. Five conformance probes fail the moment this
becomes permissive, which is the largest blast radius of any single break.

**Letting the ledger own the ceiling.** See the README. It does not.

**Reading the physical binding as optional detail.** It was absent here until
2026-09-12 and this section said adding it would test nothing the digital
binding does not. That was true while the concept had no box. It is not now:
question 36 made the household's signature over the settlement statement the
thing that charges a consumed line, and clause 35, 法11条1号 and 通信販売 all
turn on it. Change it with the same care as the rest, not as a fixture.

**Special-casing the forbidden routes.** `/segments`, `/broadcast`,
`/discounts`, `/ratings` and `/events/track` return 404 because they are not
registered, like any other unrouted path. A deny-list would make their absence
a policy rather than a structure.

## Style

- British spelling in prose, as in the sibling repositories.
- Comments say why, and cite the section or clause. The what is in the code.
- No dependencies. Bun's runtime and `node:crypto` are enough, and a
  conformance kit whose subject pulls in a framework is harder to trust.

## Git

Ordinary git, in the specification's repository. Public, so assume anything
committed is permanent.

This directory was a separate local repository until 2026-09-08 and was merged
in with its history intact. It went here rather than into a repository of its
own because the constitution's README and clause table both already said the
engine is published at `atarasy/valence`; a fourth repository would have made
that line false and added a fourth name to an argument that turns on there
being three.
