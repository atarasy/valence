# Valence

**A specification for offering goods to a person and recording what they declined.**

Valence is the commerce layer for [Ataraxia](https://github.com/atarasy/ataraxia). It sits above ACP and UCP and describes one thing those specifications do not: the interval between a merchant putting candidates in front of a household and the household deciding which of them to keep.

→ Read the specification: **[SPEC.md](SPEC.md)**

----

## What it is for

Existing commerce specifications describe what was bought. A cart, a checkout session, an order. The decline is not an event; it is the absence of one.

That absence is where the useful signal is. A household that was shown five things and kept one has told you more than a household that bought one thing after a search. Retail has known this for centuries and built businesses on it: the department store buyer who leaves three items and takes two away, the Toyama medicine seller who leaves a box and charges only for what was used, the catalogue gift that offers three hundred items so the recipient can pick one.

Valence names that interval and gives it a state machine.

## The two words

**Offer.** The atom. A set of candidates, placed with one household, with an expiry. Not an order. An offer creates no debt.

**Valence.** What a candidate ends as. Borrowed from chemistry, where it is a capacity to combine, and from psychology, where it is the sign of a stimulus. Both readings are wanted. A candidate's valence is one of:

| valence | meaning |
|---|---|
| `kept` | taken up — bought, given, included in an order |
| `returned` | declined — the event this specification exists for |
| `consumed` | used up while trying it; bought at the merchant's price on the household's signed statement, or uncharged if given |
| `defaulted` | shipped because nothing was chosen before the deadline |
| `lost` | not recovered |

A valence is measured, not judged. Nothing in this specification treats `returned` as a failure, and an implementation that optimises it away is not conformant — see the exploration floor.

## Two bindings, one machine

| | physical | digital |
|---|---|---|
| the offer is | shipped | drawn |
| valence observed by | what comes back | what the person taps |
| stock risk | with the merchant or brand | none |
| goods it suits | ambient, light, high-margin | anything |
| settles by | reconciling the collection; consumed lines require the household's signed statement | ordering the kept |

The state machine is identical. Implementations differ in fulfilment and in one default: for a physical offer, the goods are already there and expiry means recovery. For a digital offer, **silence means nothing happens.** An order is a debt and is never created by default.

## Catalogue revision 3

A product entry **MAY** carry a display `name` (at most 120 Unicode code points) and `variant` (at most 60), D-1, decided 2026-09-23: text only, never presentation (clause 54), rendered in the hub's own type exactly as a merchant's disclosure items are. A publication carrying either signs revision 3 of the catalogue signature (`valence.catalogue.3`); one carrying neither signs revision 2 unchanged, byte for byte. A candidate and a settlement line copy both fields from the catalogue, never the request, and omit the key rather than send it null where the catalogue gave none. See `SPEC.md` §3.

## Conformance

Valence conformance is a requirement of the [Ataraxia](https://github.com/atarasy/ataraxia) mark, and several clauses of that constitution are enforced here rather than in any user interface:

- **The exploration floor** (clause 26). An offer must contain a minimum number of candidates **this household has never been offered by this presenter**. `POST /offers` rejects an offer that does not, and a presenter with nothing new for a household makes it no offer at all. This is why selling out is not an achievable state. **The rule said "predicted not to convert" until 2026-09-09**, which asked a presenter to spend its shelf on goods it expected nobody to want; novelty is what the clause is about, and a presenter is free to fill the floor with the never-offered products it thinks most likely to be kept.
- **No negative signal to the giver** (clause 16). Nothing in the gift-facing response surface can express a recipient's inaction.
- **Absent capabilities** (clauses 28, 29, 30). There is no discount object, no per-person event store, no urgency field. Not disabled — absent.

Conformance tests live in the Ataraxia repository. **The suites are written**, and they run against any implementation over HTTP, importing nothing from one.

## The reference engine

[`engine/`](engine/) implements the digital and physical bindings. It exists so the conformance suites have a subject, and it is not the hub: a member opens Atarasy, and this is the engine underneath an offer. Storage is in memory by default, with persistence available through `VALENCE_DB`. It has no authentication or identity root and should not be deployed.

**Bun 1.2.19**, everywhere this repository or its siblings are run: a newer Bun rewrites `bun.lock` on install, which is a change to the repository. `bun install --frozen-lockfile` in each package that has a lockfile refuses to make that change silently.

On a machine with no Bun installed, `curl -fsSL https://bun.sh/install.sh | bash -s -- bun-v1.2.19` installs that version directly. On a machine that already has a different Bun on `PATH`, that installer replaces it; instead download the release zip for the platform from the [bun-v1.2.19 release](https://github.com/oven-sh/bun/releases/tag/bun-v1.2.19) (`bun-darwin-aarch64.zip`, `bun-darwin-x64.zip` or `bun-linux-x64.zip`), unpack it into a directory such as `.bun-1.2.19`, and put that directory first on `PATH`. The machine's own Bun is left untouched.

Working across the Atarasy concept means four repositories — [`atarasy/valence`](https://github.com/atarasy/valence) (this one), [`atarasy/atarasy`](https://github.com/atarasy/atarasy), [`atarasy/ataraxia`](https://github.com/atarasy/ataraxia) and [`VoxTechnologies/vox`](https://github.com/VoxTechnologies/vox) (private) — and they are read as siblings: `git clone` each into one parent directory of your choosing (for example `~/Documents/GitHub`, or a fresh directory made for a walkthrough); each checkout keeps its repository's own name (`valence`, `atarasy`, `ataraxia`, `vox`) inside that parent. `engine/scripts/conformance.sh` prefers a sibling `ataraxia/tests` next to this repository's parent when one exists, and otherwise falls back to `~/Documents/GitHub/ataraxia/tests`; `experiments/`'s relative imports across packages assume the same side-by-side layout. Set `ATARAXIA_TESTS` to override either default.

`engine/scripts/conformance.sh` also starts servers on ports 8788, 8888, 8988 and 9088; stop anything else already listening there, including a local member API (`experiments/member-postgres`), which defaults to 8788 as well.

**The specification is the normative half.** Where the two disagree, `SPEC.md` wins, and a change to the engine that would make the specification false is a change to the specification that has not been written yet.

Writing it found three holes in this document, each corrected in the same pass:

- The exploration floor could be satisfied by relabelling. §5.1 gave the merchant permission to mark a candidate and forbade nothing, so marking the items most expected to be kept met the count and clause 26 cost nothing to obey.
- §9 listed eight endpoints and the conformance suites needed two more, so an implementation built from that section alone failed the suite. The same section put the reserve at offer creation, which contradicts §6.4 and orphans a hold every time the floor refuses an offer.
- §6.4's ceiling has no owner but the implementation. A reserve-and-commit ledger does not supply it: the ones this maps onto treat a commit above the hold as an adjustment and refuse it only when the balance cannot cover the difference, which makes a funded household the case that slips through.

## Status

Draft, September 2026. The specification and reference engine are written. Current test evidence belongs with the conformance logs rather than a fixed suite count in this overview. No production implementation exists. Expect breaking changes.

## Licence

[MIT](LICENSE). The licence does not grant rights to the Ataraxia, Atarasy or Valence names; see the [trademark policy](https://github.com/atarasy/ataraxia/blob/main/TRADEMARKS.md).
