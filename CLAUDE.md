# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this repository is

A reference implementation of the Valence Protocol, digital binding only,
written so the Ataraxia conformance suites have a subject. Bun and TypeScript,
no dependencies beyond type definitions, everything in memory.

**All documents and code here are in English.**

| Related | What |
|---|---|
| `~/Documents/GitHub/valence` | the specification. Section numbers in comments refer to its `SPEC.md` |
| `~/Documents/GitHub/ataraxia` | the constitution and the conformance suites this is run against |
| `~/Documents/GitHub/hacci/Projects/Atarasy/` | the private Japanese strategy documents, where decisions are made |

Change flows one way: **decide in the vault, specify in `valence`, implement
here.** A design decision made only in this repository will be lost. What
belongs here instead is the opposite direction: a requirement the specification
states that turns out to have no owner. Record those, and open a correction in
`valence`.

## The rule that governs the tests

**A test that cannot fail is not a test.** Every probe in the conformance
suites carries a note naming the mutation it was shown to catch, and
`scripts/mutations/` holds those mutations so anyone can rerun them.

Do not add a probe to those suites without a mutation. Do not write the note
before running the mutation: the first draft of the absence suite had notes
written from intent, and two of them described behaviour the mutation did not
produce.

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

**Adding the physical binding to make the model complete.** Recovery,
redistribution and loss add operations and test nothing the constitution needs
tested that the digital binding does not. The valence values exist in
`types.ts` and settle correctly; what is absent is the operational half.

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

Ordinary git. Nothing here is published yet; the repository is local. Before it
is pushed anywhere, decide whether the reference implementation belongs under
the `atarasy` organisation at all, which is the same question the constitution's
README already answers about itself and answers provisionally.
