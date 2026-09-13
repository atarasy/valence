# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this repository is

The **Valence Protocol**: a specification for offering goods to a person and recording what they declined, and the reference engine that implements it. `atarasy/valence`, public, MIT.

`SPEC.md` is the specification and the normative half. `engine/` is a reference implementation of the digital and physical bindings, written so the Ataraxia conformance suites have a subject. It is not the hub: a member opens Atarasy, and this is the engine underneath an offer.

**The two halves are not equal.** The specification is what an implementer reads and what the mark is granted against. The engine is one reading of it, and where they disagree the specification wins. A change to `engine/` that would make the specification false is a change to `SPEC.md` that has not been written yet.

**All documents in this repository are in English.**

| Related | What |
|---|---|
| `~/Documents/GitHub/ataraxia` | the constitution this specification enforces, and the conformance tests |
| `~/Documents/GitHub/hacci/Projects/Atarasy/` | the private English strategy documents. `03_Spec_Valence_Engine.md` is the working copy of this specification |
| `~/Documents/GitHub/meter` | the ledger this specification's §6.4 maps onto. `reserveCredits` → work → `commitReservedUsage` / `releaseCreditReservation` |
| `engine/` | the reference implementation, in this repository since 2026-09-08. Read `engine/CLAUDE.md` before changing it |

Change flows one way: **decide in the vault → specify here → implement.** A design decision made only in this repository will be lost.

## The one idea

Existing commerce specifications describe what was bought. ACP has a cart and a checkout session; UCP has orders and returns. **The decline is not an event in either; it is the absence of one.**

Valence names the interval between a merchant placing candidates in front of a household and the household deciding which to keep, and gives that interval a state machine. A candidate's outcome is its `valence`: `kept`, `returned`, `consumed`, `defaulted`, `lost`. `returned` is the event this specification exists for.

A valence is **measured, not judged**. Nothing here treats `returned` as failure, and §5.2 says why: an engine that maximises the kept ratio stops exploring, removes the household's freedom to decline, and destroys the only signal that cannot be obtained elsewhere.

## Clauses enforced here rather than in an interface

This specification is where several constitutional clauses become structural. Weakening any of these to a recommendation defeats the point of writing them into a protocol.

| Clause | Enforced as |
|---|---|
| 26 exploration floor | `POST /offers` returns `422`. No configuration bypasses it; the rate cannot reach zero (§5) |
| 10 curator cannot price | No field, parameter or configuration raises a household's price above the merchant's own (§3.1) |
| 16 no negative signal | No field in the giver's response surface can express or permit inference of recipient inaction (§7.2) |
| 27–30 absent capabilities | No discount object, no rating, no urgency field, no per-person tracking id (§3.3); no `/segments`, `/broadcast`, `/discounts`, `/ratings`, `/events/track` (§9.1) |
| 32 silence is not consent | An undecided digital candidate becomes `returned` at expiry, and no configuration makes it `kept` (§2.2) |
| 22 lineage is not gated | A well-formed, correctly signed edge is accepted regardless of which client produced it (§7.1) |
| 25 no unredeemed revenue | Ceremonial offers ship a default; nothing is earned from a recipient who does not choose (§12) |

§13 lists the conditions an implementation must meet. Anything added to the specification that cannot be checked from outside the implementation does not belong in §13.

## Things that will be tempting and are wrong

**Adding a balance.** A household balance redeemable against goods is a third-party prepaid payment instrument; registration requires ¥100M in net assets and is closed to the implementers this was written for. This entry used to end "if a design seems to need a balance, it needs a deduction", which was true while a trial settled against a cost basis. That basis left the model on 2026-09-09 (clause 10), so there is now nothing to deduct: a design that seems to need a balance needs one of the two bases in §6.2, which are the merchant's price for what was used and zero for what was given.

**Charging the household for `lost`.** §3.2. Loss is borne by whoever holds stock risk. The trust model is the point; loss rate is an operating metric, not a receivable.

**Letting the two bindings diverge.** §2.2 is the *only* place `physical` and `digital` differ in the state machine, and the divergence is one table. A second divergence is a design smell — check whether it belongs in fulfilment instead.

**Treating the estimate as advisory.** §6.4: the reserve must be an upper bound, and a settlement above it must fail rather than silently exceed the household's authorisation.

An earlier version of this file said the requirement mirrors Meter, "where an estimate below the actual is rejected at commit and the hold released". That is wrong and was corrected on 2026-09-08 after reading the code. Meter's `commitReservedUsage` charges the difference as a `usage_hold_adjustment` and succeeds; it fails only when the balance cannot cover that difference, which makes a funded account the case that slips through. It is funded accounts and no others: the commit path compares the raw balance and never calls `authorizeSpend`, so a post-paid account carrying a negative balance is refused. Meter's own architecture note describes the underfunded path and reads as though it were the rule. **A funded household is exactly the case where the authorisation is exceeded quietly.** The ceiling is the implementation's obligation and no ledger underneath supplies it.

**Adding a sponsored-placement field to the feed.** §8 has no room for one, deliberately (clause 14).

## Style

- British spelling. RFC 2119 keywords in bold where normative.
- Section numbers are referenced from `ataraxia/tests/README.md` and from the vault. Append rather than renumber.
- Tables over prose for anything with more than two dimensions.
- §14 holds what is unresolved. Move an item out of it when it is answered; do not answer it silently in the body.

## Open, and worth knowing before extending

- Binding an AP2 mandate to **direct-debit rails**. The specification assumes card authorisation. No equivalent exists for account transfer and one is needed for several plausible deployments.
- **Multi-hop lineage attribution** — the settlement side is out of scope here and belongs with inter-firm netting, not with this specification.
- Whether the §8 feed extension should be proposed to the ACP community or stay a private extension.
- Default values for the exploration rate, the recovery deadline and the loss threshold. All are deployment parameters with **no recommended figure**, on purpose: publishing one before any deployment exists would make it a standard by accident.
