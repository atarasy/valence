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
| `consumed` | used up while trying it, settled at cost |
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
| settles by | reconciling the return | ordering the kept |

The state machine is identical. Implementations differ in fulfilment and in one default: for a physical offer, the goods are already there and expiry means recovery. For a digital offer, **silence means nothing happens.** An order is a debt and is never created by default.

## Conformance

Valence conformance is a requirement of the [Ataraxia](https://github.com/atarasy/ataraxia) mark, and several clauses of that constitution are enforced here rather than in any user interface:

- **The exploration floor** (clause 30). An offer must contain a minimum number of candidates the merchant's own model predicts will not convert. `POST /offers` rejects an offer that does not. This is why selling out is not an achievable state.
- **No negative signal to the giver** (clause 19). Nothing in the gift-facing response surface can express a recipient's inaction.
- **Absent capabilities** (clauses 32, 33, 34). There is no discount object, no per-person event store, no urgency field. Not disabled — absent.

Conformance tests live in the Ataraxia repository. Four of the six suites are written, and they run against any implementation over HTTP.

## The reference engine

[`engine/`](engine/) implements the digital binding. It exists so the conformance suites have a subject, and it is not the hub: a member opens Atarasy, and this is the engine underneath an offer. Everything is held in memory, there is no persistence and no identity root, and it should not be deployed.

**The specification is the normative half.** Where the two disagree, `SPEC.md` wins, and a change to the engine that would make the specification false is a change to the specification that has not been written yet.

Writing it found three holes in this document, each corrected in the same pass:

- The exploration floor could be satisfied by relabelling. §5.1 gave the merchant permission to mark a candidate and forbade nothing, so marking the items most expected to be kept met the count and clause 30 cost nothing to obey.
- §9 listed eight endpoints and the conformance suites needed two more, so an implementation built from that section alone failed the suite. The same section put the reserve at offer creation, which contradicts §6.4 and orphans a hold every time the floor refuses an offer.
- §6.4's ceiling has no owner but the implementation. A reserve-and-commit ledger does not supply it: the ones this maps onto treat a commit above the hold as an adjustment and refuse it only when the balance cannot cover the difference, which makes a funded household the case that slips through.

## Status

Draft, September 2026. The specification is written and the reference engine passes the four written conformance suites. No production implementation exists. Expect breaking changes.

## Licence

[MIT](LICENSE). The licence does not grant rights to the Ataraxia, Atarasy or Valence names; see the [trademark policy](https://github.com/atarasy/ataraxia/blob/main/TRADEMARKS.md).
