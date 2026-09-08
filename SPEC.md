# Valence Protocol

**Version**: draft, 2026-09-08
**Status**: no production implementation. Expect breaking changes.
**Constitution**: [Ataraxia](https://github.com/atarasy/ataraxia). Clause numbers below refer to it.

----

## 1. Scope

Valence describes the interval between a merchant placing candidates in front of a household and the household deciding which to keep. It sits above ACP and UCP: discovery, checkout and order management belong to those specifications, and Valence hands off to them once a candidate is kept.

It does not define payment, fulfilment, tax, returns handling, or identity. It assumes AP2 for authorisation and a public-key identity whose root is out of scope.

### 1.1 Terms

**MUST**, **MUST NOT**, **SHOULD** and **MAY** are used as in RFC 2119.

**Household** — the recipient of an offer. One key, one ledger. May be a person or a family sharing a mandate.

**Presenter** — the party placing the offer. A merchant, or a representative acting for one.

**Offer** — a set of candidates, placed with one household, with an expiry.

**Candidate** — one item within an offer.

**Valence** — the outcome of a candidate.

**Binding** — `physical` or `digital`. Determines fulfilment and the expiry default.

----

## 2. The offer

An offer is the atom of this specification. It is not an order and it creates no debt.

```
offer
  id                     string, unique
  binding                physical | digital
  household              key identifier of the recipient
  presenter              identifier of the merchant or representative
  purpose                gift | replenish | trial | ceremonial | assortment
  price_band             { min, max }. Present on a ceremonial offer, null otherwise (§12, clause 23).
  config_version         version of the presenter's pricing and rules, frozen at creation
  presented_at           timestamp, null until presented
  expires_at             timestamp
  state                  drafted | presented | decided | expired | withdrawn | settled
  exploration_floor_met  boolean, validated at creation (§5)
  mandate                reference to the AP2 intent mandate governing this offer
  candidates             array, 1..n
```

### 2.1 State

```
drafted ──present──▶ presented ──decide───▶ decided ──settle─────────▶ settled
                         │                                              ▲
                         ├──expire────────▶ expired ──settle_default────┘
                         └──withdraw──────▶ withdrawn
```

| transition | effect |
|---|---|
| `present` | physical: shipped. digital: rendered in the approval surface. Sets `presented_at`. |
| `decide` | one or more candidates receive a valence. An offer MAY be decided partially and decided again before expiry. |
| `expire` | `expires_at` passed. See §2.2. |
| `withdraw` | the presenter revokes, from `drafted` or `presented` and no later. Any undecided candidate becomes `returned`. No charge. A decided offer carries the household's signature over what it decided (§10.5), and a presenter that could withdraw under it could void that signature, so an implementation MUST refuse with `409`. |
| `settle` | the offer is priced and closed. See §6. |
| `settle_default` | expiry path for offers that carry a default (§2.2). |

An offer MUST NOT move from `settled` to any other state. Corrections are new offers.

### 2.2 Expiry defaults

This is the only place the two bindings diverge in the machine, and the divergence is deliberate.

| binding | purpose | undecided candidates at expiry become | rationale |
|---|---|---|---|
| `physical` | any | `returned` | The goods are already there. Debt does not arise until use. |
| `digital` | any except `ceremonial` | `returned` | **Silence is not consent.** An order is a debt (clause 32). |
| either | `ceremonial` | exactly one becomes `defaulted`; the rest `returned` | The giver has already paid a price band. Nothing may be earned from a recipient who does not choose (clause 25). |

An implementation MUST NOT provide a configuration that makes an undecided digital candidate `kept`.

----

## 3. The candidate

```
candidate
  id                     string, unique within the offer
  product                reference into the presenter's catalogue
  quantity               integer
  unit_price             the merchant's own price. Immutable within the offer.
  merchant               who made it: the merchant of record (clauses 11, 12). From the catalogue, never the request.
  ships                  who carries it to the household (clause 12). From the catalogue.
  predicted_conversion   0..1, or null. The presenter's own model output.
  is_exploration         boolean. Counts toward the floor (§5).
  given_by               the key of whoever gave this candidate, or null. A gift is never billed to its recipient (§6.2, clause 10).
  valence                offered | kept | returned | consumed | defaulted | lost
  decided_at             timestamp, null while offered
  kept_as                self | gift | order. Present only when kept.
  lineage                reference to a lineage edge. Present only when kept_as = gift.
```

### 3.1 Price

`unit_price` is the price the merchant charges anyone, and it travels from the merchant's own feed (§8) into the presenter's catalogue with the merchant's name beside it. An implementation MUST NOT provide a field, a parameter or a configuration by which a presenter, a curator, or the platform raises the price a household pays above the merchant's own price (clause 10). A household never pays more through an offer than it would buying direct.

### 3.2 Valence

| valence | when | settlement |
|---|---|---|
| `kept` | taken up | charged at `unit_price` |
| `returned` | declined, or undecided at expiry | not charged |
| `consumed` | physical only. Used while trying. Recorded by the collection (§11.2), never decided by a household. | the merchant's price, unless the candidate was given, and a gift is never billed to its recipient (§6.2) |
| `defaulted` | ceremonial only. Shipped because nothing was chosen. | charged at `unit_price` |
| `lost` | physical only. Not recovered by the recovery deadline. | not charged to the household |

`lost` is a loss to whoever holds stock risk. It MUST NOT be charged to the household. An implementation that bills a household for unreturned goods is not conformant; the trust model is the point, and loss rates are an operating metric, not a receivable.

### 3.3 What a candidate does not carry

There is no field for a discount, a countdown, a stock-scarcity indicator, a star rating, or a per-person tracking identifier. These are absent, not disabled (clauses 27, 28, 29, 30). An implementation that adds them is not conformant.

----

## 4. Notes

A household MAY attach one line of prose to a candidate.

```
note
  candidate    reference
  author       the household
  text         string
  shared_with  [] | subset of { recipient, merchant }. Whom the writer chose to show the line to (clause 27)
```

`shared_with` defaults to `["recipient"]` when the field is absent: a line written before giving is the message that accompanies the gift, which is the only reason the field exists, and a default of nobody would make a writer opt in to the thing they were writing for. A writer who wants the line kept to themselves sends `[]`. The merchant is the other way round and is never a default, because a merchant is a party to the trade and not to the gift.

`GET /candidates/{id}/note?as=recipient|merchant` returns the lines the writer shared with that party, as text and date, and `404` when there are none. A writer has one line per candidate: a second note by the same author on the same candidate is refused with `409`, because a list of lines is a count and a count is an aggregate. There is no rating, no score, no route that aggregates notes across candidates or households, and no party other than the writer, the recipient and the merchant that a line can be shared with. A note written before giving becomes the message that accompanies the gift; a note shared with the merchant is the one line of feedback a maker receives, and it arrives as a line.

----

## 5. The exploration floor

**`POST /offers` MUST reject an offer whose candidates include fewer than `floor(n)` marked `is_exploration`, where n is the candidate count.** The rejection is `422`.

```
floor(n) = max(1, ceil(n * rate))
```

**A presenter that has nothing new for this household cannot make an offer at all.** When no product across every catalogue version this presenter has registered is novel to the household (§5.1), `POST /offers` MUST refuse with `422 nothing_new`. The floor does not fall to what the presenter has left: a cap of that shape was written on 2026-09-09 and withdrawn the same day, because it made selling out reachable for any small catalogue, which §5.2 and clause 26 say it is not. What it costs is that a presenter with a narrow range cannot offer to a household it has already shown everything to, until its range grows. That is the pressure the clause is for.

Novelty is counted **across every catalogue version this presenter has registered**, not the version an offer names: counting over the named version would let a presenter register a narrower catalogue per offer and owe no exploration, which an adversarial pass measured.

`rate` is a deployment parameter. It MUST be greater than zero. A conforming implementation MUST NOT expose a configuration that sets it to zero or that bypasses the check.

### 5.1 What counts

A candidate MAY be marked `is_exploration` only when this presenter has never offered the product to this household and the household has not been given it: no prior presentation, whatever its verdict, and no lineage edge to the household for the product. A product the household bought, was given, or declined is not exploration.

A candidate that fails this **MUST NOT** be counted toward the floor, and `POST /offers` **MUST** reject an offer that marks one. A product appears at most once in an offer: a line carries a quantity, and the same product on two lines is one novelty counted twice toward the floor. An implementation MUST refuse a duplicate with `400`.

The floor counts novelty and nothing else. Which never-offered products a presenter puts in the floor is its own best guess, and the specification does not judge the guess: a prediction is the presenter's own number, and a rule that asked for a low one would fill the floor with what the presenter expects to fail, which is waste, not exploration. A presenter that wants the floor to be worth carrying fills it with the never-offered products it thinks most likely to be kept. Earlier versions of this section admitted a candidate on a low prediction alone; that was withdrawn on 2026-09-09.

Without this the floor is satisfiable by relabelling. A presenter marks the items it most expects to be kept, the count is met, and clause 26 becomes a formality while every reading of §5 still passes. The permission above is on the presenter and cannot be checked from outside; this obligation is on the implementation and can be.

### 5.2 A presenter is a key, not a name

The floor counts what **this presenter** has offered this household, so what a presenter is decides what the floor is worth. A presenter is the holder of a key: a catalogue is accepted only when it is signed by the key registered for the presenter it names, so nobody publishes catalogues under another presenter's name, and a presenter cannot disown one it published.

An offer says whether an identity root endorsed that key (`presenter_attested`, §7.1). Where it did, changing name means presenting a second identity to that root, which is a thing the root can see and a household can weigh. Where it did not, the name is the presenter's own word.

**What this does not close, stated plainly.** An operator that can obtain two identities is two presenters as far as this specification can tell, and a household that has seen everything from one can be shown the same range again by the other, with the floor satisfied both times. Only the root that endorses identities can say the two are one. Nothing inside an engine can: it sees keys, and the question is about who holds them. This was measured on 2026-09-09, when an adversarial pass renamed a presenter and watched a household's history disappear.

### 5.3 Why

An engine that maximises the kept ratio stops exploring, removes the household's freedom to decline, and destroys the only output that cannot be obtained elsewhere: which declines predict the market. Selling out is therefore not an achievable state in a conforming implementation (clause 26).

### 5.4 Disclosure

Exploration candidates MUST NOT be concealed. The presentation surface SHOULD indicate that a candidate is one this household has not been offered before. A household MAY reduce `rate` for its own offers. It MUST NOT be able to reach zero.

----

## 6. Settlement

```
settlement
  offer            reference
  settled_at       timestamp
  kept_amount      sum of unit_price * quantity over kept and defaulted
  consumed_amount  sum over consumed candidates that were not given, at the merchant's price
  lost_amount      sum over lost, informational, not billed to the household
  charged          what the household is actually billed
  lines[]          one per candidate charged or lost: candidate, product, merchant, ships, valence, amount (clause 11)
  signed_by        the presenter
  signed_as        "agent". The presenter is not the seller; it signs for the merchants named on the lines (clause 11)
  receipt          signed by the presenter as the merchants' disclosed agent, delivered to the household
```

Every line names its merchant of record. A receipt that totals without saying who sold each item has hidden the merchant behind the curator, which clause 12 forbids and clause 11 makes a question of who is liable.

`charged` **MUST** equal `kept_amount + consumed_amount`, and it is what the ledger commits.

The field is not redundant, and it was added on 2026-09-08 after a conformance probe failed to catch an implementation that billed for `lost`. Without it the settlement reports a breakdown and the ledger takes a number, and nothing in the record connects the two: a household reading a receipt that says nothing was kept has no way to see that it was charged anyway. An implementation whose `charged` disagrees with the sum above is not conformant even when every other amount is right.

### 6.1 Nothing accrues

Nothing carries from one settlement to the next. There is no balance, and since 2026-09-09 there is nothing to deduct either: a trial is a sample, which is free, or it is goods, which are bought at the merchant's price. An implementation MUST NOT hold a household balance redeemable against future goods, which is a prepaid payment instrument in several jurisdictions and out of reach for most implementers.

### 6.2 What was used is bought; what was given is a gift

Two bases exist and no third. A candidate the collection records as `consumed` settles at the merchant's price, the same price the household would have paid to keep it: using something is buying it, which is the rule of 先用後利 (use first, settle after). A candidate that carries `given_by` was given, by a maker, by a merchant or by a friend, and **a gift is never billed to the person who received it**: its line settles at zero and names the giver. What the giver owes the merchant is settled between them, in flow C, where the recipient never sees it.

**No cost of goods is ever quoted to a person, and no field carries one.** An earlier version of this section charged `consumed` at the presenter's cost basis, so that trying was "neither free nor full price". Two things were wrong with it. A cost basis in a household's receipt tells a person what the maker paid and prices the same goods two ways. And the middle term reads as a discount, which is what clause 28 removes everywhere else; goods that are normally sold at a price are not quietly worth less because a household is trying them. A maker that wants a person to try something gives it, at the price it is worth, and the record says who gave it. The catalogue has no `cost` field.

A gift arriving this way is the same event as a gift between people (§7): whether a lineage edge exists for it is the giver's business, since an edge carries the giver's signature and a presenter cannot make one on their behalf.

### 6.3 Terms are frozen at presentation

A settlement MUST use the `config_version` stamped on the offer at creation. A presenter who changes prices or rules mid-flight does not change what an outstanding offer costs.

### 6.4 Ledger mapping

Valence assumes an authorising ledger with a reserve-and-commit primitive. The mapping:

| Valence | ledger |
|---|---|
| `present` | reserve, held at the upper bound of the offer |
| `settle` | commit the actual; the difference is released |
| `expire` or `withdraw` with nothing kept | release; no charge |
| `offer.id` | idempotency key |
| `expires_at` | hold expiry |

The estimate at reserve MUST be an upper bound of the eventual settlement. A settlement above the reserve MUST fail rather than silently exceed the household's authorisation.

This is a requirement on the implementation, not on the ledger it uses. A reserve-and-commit primitive does not supply it: the ledgers this maps onto typically treat a commit above the hold as an adjustment and refuse it only when the account cannot cover the difference, which means a funded household is the case that passes. An implementation MUST check the ceiling itself before it delegates.

----

## 7. Lineage

A lineage edge records that one household gave a specific product to another. It is created when a candidate is `kept` with `kept_as = gift`.

```
edge
  id
  from        key identifier of the giver
  to          key identifier of the recipient
  product     reference
  merchant    reference
  kind        gift | return | regift | thanks
  occasion    string
  receipt     reference to the merchant's signed transaction receipt
  signature   by the giver's key
  created_at
```

### 7.1 Recognition

An edge is accepted when it is well formed and its signature verifies against the giver's registered key, and **it is not discriminated by which client software produced it** (clause 22). A conforming endpoint MUST accept such an edge regardless of its origin.

An accepted edge carries `attested`: whether an identity root endorsed the giver's key (clause 2), or the key is merely registered. Both are recorded and both are shown, with `attested` on the edge and on every row of the circle, because a viewer is entitled to know which of their edges rest on a root and which are somebody's word.

**An unattested edge makes nothing known.** It does not make a product known to the household it names, so it never removes that product from what is novel to them (§5.1). Anyone can register a key, so an unattested edge that counted toward what a household has been given would let a stranger empty that household's exploration floor by writing edges at it. Where a jurisdiction has no root a person can use (`02` §3.2 of the concept documents), every edge is unattested, and what is lost is the density of lineage rather than the ability to give.

Who endorses a key is clause 2's root and not this specification's business. The reference engine takes it as a flag on the fixture route that registers a key; a conforming host reads it from the root.

### 7.2 What the giver may see

The giver's response surface MAY show acts of the recipient: a `regift`, a `return`, a `thanks`. It **MUST NOT** show, or allow to be inferred, that a recipient did not reorder, did not open, or did not respond (clause 16).

This is a constraint on the schema, not on the interface. A conforming API has no field whose absence or value discloses recipient inaction. Implementers should test for inference, not only for presence.

### 7.3 Reciprocation

An implementation MAY make reciprocation easy. It MUST NOT notify, remind, or impose a deadline on it (clause 18).

### 7.4 Duplicate avoidance

A giver about to give may ask whether this household already has a product, and the answer is one bit. It runs only under a grant the recipient gave that giver for this use (clause 20, §9), only against a live action, and the asking is written into the recipient's own record, readable at `GET /households/{id}/queries`. An implementation MUST refuse the query with `422` when there is no live grant or no live action, and MUST record the row before returning the answer.

There is no route that enumerates what a household has received (clause 20). One bit at a time is still a read of the list, which is why the two bounds above exist and why the reads are visible to the person whose list it is.

### 7.5 A grant to a computation

Clause 9 admits one calculation across nodes: a person may grant their data to it, the grant is asked for that use, and the result is a form from which no node can be recovered. Clause 39 names the same thing as the one exception to a person never selling their data.

What runs is not this specification's business, and no computation is defined here. What is defined is the shape a grant must have to be one:

```
permission
  kind          party | computation
  result_form   "aggregate" on a computation, absent on a party grant
```

A grant with `kind: computation` MUST name `result_form: "aggregate"` and an implementation MUST refuse any other value with `422`, including one that names raw or per-person data. A grant to a party MUST NOT carry a result form at all. Everything else a grant must satisfy applies unchanged: it is asked against a live action, it is scoped, it is time-limited, it is revoked on its own, and it carries no price (clause 39).

The enum has one member on purpose. A person cannot grant raw data to a computation even if they wish to, because a model trained on it cannot un-train a revoked grant (clause 40), and whoever held the raw data would be holding per-person events (clause 29). The limit is on what a grant can express, which is the only place it can be enforced.

### 7.6 The recipient's record

A recipient's node records the fact of receipt and nothing else until that household becomes a giver (clause 19). No preference, no profile, no score is derived from having received.

### 7.7 Display

Lineage is displayed as density within the viewer's own circle. Totals, network size and popularity rankings MUST NOT be displayed (clause 21). The merchant is never hidden.

----

## 8. Feed extension

A Valence-conformant merchant extends its ACP product feed. The two gift fields were named `valence.sample_unit` and `valence.trial_eligible` until 2026-09-09: the same goods, described as a sample, are received as a promotion and read as worth less than their price, and described as a gift are received at their price from someone who chose to give them. The field names follow the thing rather than the trade's habit.

| field | meaning |
|---|---|
| `valence.gift_unit` | the unit and quantity in which this product can be given rather than sold (§6.2) |
| `valence.gift_eligible` | whether the maker allows it to be given |
| `valence.gift_meta` | wrapping options, ceremonial eligibility, price band |
| `valence.lineage_hook` | endpoint accepting lineage edges |
| `valence.reciprocity` | whether purchase history is returned to the household in standard form |

`valence.reciprocity` is the field a household's agent reads when deciding routing preference (clause 42). A merchant that does not return history is not excluded from anything; it is not preferred.

There is no sponsored-placement field, and a conforming feed schema has no room to add one (clause 14).

----

## 9. Endpoints

```
POST   /offers                      create. Validates the exploration floor.
POST   /offers/{id}/present         ship or render. Reserves.
POST   /offers/{id}/decisions       assign valences to candidates (signed as the mandate, §10.5, clause 35)
POST   /offers/{id}/settle          price, commit, return a signed receipt
POST   /offers/{id}/withdraw        revoke, release
POST   /offers/{id}/remind          the one reminder (§10.4, clause 33)
GET    /offers/{id}                 one offer, with its candidates
GET    /offers/{id}/settlement      the settlement, once there is one
GET    /offers?household={id}&presenter={id}   the presenter's vertical view, and only that presenter's (clause 8)
POST   /candidates/{id}/note        one line, shared with whom the writer says
GET    /candidates/{id}/note?as=    the lines shared with that party (clause 27)
POST   /lineage                     accept an edge
```

The same operations SHOULD be exposed as MCP tools, so that a merchant's agent and a household's agent call the same surface.

Three of these lines were corrected on 2026-09-08, after the conformance suites were written and found to require a surface this section did not describe.

- **The reserve moves from `POST /offers` to `POST /offers/{id}/present`.** The earlier text put it on creation, which contradicts §6.4's table and orphans a hold every time the exploration floor refuses an offer.
- **`POST /offers/{id}/remind` and `GET /offers/{id}` are named.** Both were required by the specification's own prose, §10.4 and §2.1, and neither appeared here. An implementation built from this section alone had no route for the one reminder clause 33 permits, and no way to read back the state the state machine describes.

A fourth line was added on 2026-09-09. **`GET /offers/{id}/settlement`** reads a settlement back. §6 delivers a signed receipt to the household in the response to `POST /offers/{id}/settle` and gave no way to ask for it again, so a household that lost that response had lost its receipt, and clause 43's export could omit settlements while every read still agreed. A conformance probe comparing two hosts found it: the export dropped the settlements and the hosts still answered alike, because nothing asked.

An endpoint a conformance test depends on belongs in this list. Where the two disagree, this list is what an implementer reads.

### 9.1 Endpoints that must not exist

`/segments`, `/broadcast`, `/discounts`, `/ratings`, `/events/track`.

A conforming implementation does not have these routes. Their absence is checkable, and it is checked.

----

## 10. Digital binding: drafting

1. **Input.** History from the presenter's vertical ledger, season, prior valences, the exploration floor.
2. **Generate.** Either the merchant's agent or the household's agent composes candidates. Both enter through `POST /offers`. The specification does not care which, and the endpoint MUST NOT behave differently.
3. **Present.** Rendered in the household's approval surface with alternatives, and with the reason any candidate was excluded. The reason is one of the published rules and nothing else (clause 6, clause 36):

   | Rule | What it means |
   |---|---|
   | `auto_renewal` | the candidate carries an auto-renewing subscription (clause 48) |
   | `obstructed_cancellation` | cancelling it is harder than buying it (clause 48) |
   | `manufactured_scarcity` | the offer manufactures urgency or scarcity (clause 48) |
   | `late_price` | the price rises at checkout, by carriage or a fee not shown with the candidate (clause 48; inside the network clause 10 prevents it, outside it does not) |
   | `outside_mandate` | the candidate falls outside the mandate the household gave |
   | `declined_before` | the household returned this product before, and the agent is not offering it again |

   An implementation MUST refuse a deliberation whose reason is not in this list, with `400`. Adding a rule is a change to this specification, which is what makes an agent's routing auditable: every exclusion a person sees names a rule they can read here.
4. **Decide.** Per candidate. One tap to confirm. At most one reminder (clause 33).
5. **Sign.** The decided set is signed as an AP2 mandate, and `POST /offers/{id}/decisions` carries the signature beside the decisions (clause 35). What is signed is the set in this canonical shape, so a signature made by one hub verifies at any conforming endpoint:

   ```
   <offer id>
   <candidate>:<valence>:<kept_as or empty>:<lineage or empty>
   ```

   one line per decision in ascending candidate id, UTF-8, `\n` between lines; the signature is ed25519 over those bytes, base64, by the key registered for the offer's `mandate`. An implementation MUST refuse, with `422`, a decided set with no signature, a signature by another key, or a signature over a set other than the one sent; nothing is written on refusal.
6. **Order.** Kept candidates proceed to an ACP checkout session.

Drafting from history alone converges on last week's order. The exploration floor is what prevents it; trial candidates are what fill the floor.

----

## 11. Physical binding: recovery

| stage | rule |
|---|---|
| recovery | the presenter collects unopened candidates and records `returned` |
| redistribution | permitted only for unopened, ambient goods within the freshness window, with a temperature record where the category requires it. Local food-safety practice governs. |
| loss | after the recovery deadline plus a grace period, `lost`. Borne by the stock holder, never billed to the household. |
| cadence | monthly settlement |

### 11.2 Silence does not mean the same thing in the two bindings

§2.2 makes an undecided digital candidate `returned` at expiry, because an order is a debt and none should be created by silence. **The physical binding does not follow that rule and must not.** The goods are in a household's home. Nobody has looked at them, and recording them as returned is a claim about the world rather than a default.

So an undecided physical candidate stays undecided at expiry, and only two things resolve it:

- **the collection**, which records what came back unopened as `returned` and what was used as `consumed`
- **the deadline**, after which anything neither collected nor decided becomes `lost`

The grace period after the recovery deadline is a deployment parameter with no recommended figure, as the exploration rate is. An implementation MUST NOT make an uncollected physical candidate `returned`, and MUST NOT bill a household for one that became `lost`.

**Neither `consumed` nor `lost` is a verdict a decision may carry.** `POST /offers/{id}/decisions` MUST refuse a decided set naming either, with `422`. Both are facts the collection or the deadline records about goods in a home, and a household that could declare them would pay cost for what it kept, or nothing for what it lost. This was added on 2026-09-09, after an adversarial pass measured a household signing `consumed` and `lost` over its own goods and paying 2000 of 6000.

A candidate MUST NOT appear in both the returned and the consumed list of one collection, and a collection MUST NOT be recorded twice for one offer.

### 11.1 Eligibility

A product is eligible for the physical binding when it is ambient, keeps for at least three times the offer period, is small enough that ten fit in one container, and carries enough margin to absorb recovery and redistribution. Chilled and bulky goods are out of scope for this binding. Regulated categories, including alcohol and medicines, are out of scope entirely.

**Eligibility is recorded on the presenter's catalogue and checked when the offer is created**, not when the goods are loaded. The presenter is the party that knows whether a product is ambient and how long it keeps, and creation is the last moment at which refusing costs nothing.

The digital binding has no eligibility restriction.

----

## 12. Ceremonial offers

The purpose `ceremonial` covers the return gift: the offer sent to many recipients after a wedding, a birth, or a funeral, where the giver has chosen a price band and each recipient chooses one item.

A ceremonial offer names a `giver` beside its `price_band`, and the giver is the payer: the reserve is held against the giver and the settlement's `payer` names them. The `household` on the offer is the recipient, who chooses. An implementation MUST refuse a ceremonial offer that names no giver, and MUST refuse `giver` or `price_band` on any other purpose. Before 2026-09-09 the engine reserved and committed against the household on the offer, which billed the recipient of a return gift for the gift.

| requirement | clause |
|---|---|
| The recipient chooses; the giver does not see the candidates | 27 |
| The offer carries the band the giver chose, shown to the recipient on the approval surface as well as the offer, and no candidate lies outside it. The band bounds the **line**, `unit_price × quantity`, not the unit: five units of something inside the band is five times the band. A candidate outside it is refused with `422 outside_band`, and a ceremonial offer without a band with `400` | 26 |
| If nothing is chosen before expiry, one candidate is `defaulted` and shipped. "Nothing chosen" is the whole condition: a recipient who kept one item and left the rest has chosen, and no default ships beside a kept candidate | 28 |
| Nothing is earned from an unredeemed offer | 28 |
| Cards, wrapping and denominational wording match local convention exactly | 29 |

The last is not decoration. An implementation that gets the wording of a funeral return wrong has failed regardless of the rest.

Candidates for a ceremonial offer are composed from convention — what is customary for the occasion and the recipient's rough demographic — not from a model of the recipient, who by definition has no record.

----

## 13. Conformance

An implementation is Valence-conformant when it:

1. implements the state machine in §2.1 with the expiry defaults in §2.2
2. rejects offers below the exploration floor with `422` and exposes no bypass
3. has no route from §9.1 and no field from §3.3
4. discloses no recipient inaction on the giver's surface (§7.2)
5. holds no household balance (§6.1)
6. freezes terms at `config_version` (§6.3)
7. accepts well-formed lineage edges regardless of client (§7.1)
8. bills no household for `lost` (§3.2)
9. refuses `consumed` and `lost` as decisions, refuses to withdraw a decided offer, and never bills a recipient for a candidate that was given (§2.1, §6.2, §11.2)
10. bills the giver of a ceremonial offer, not the recipient, and ships a default only when nothing was chosen (§12)
11. verifies what it imports: a signed edge, an offer belonging to the household whose path it arrives on, and never over a settled offer (§14.2), and exports a shop's ledgers in full (§14.1)
12. records a mandate only with the signatures its change needs, and refuses an offer over the ceiling or on a lapsed mandate (§16)

Conditions 9 to 11 were added on 2026-09-09, after an adversarial pass measured each of them open in the reference engine.

Tests are in the [Ataraxia](https://github.com/atarasy/ataraxia) repository. Passing them is what entitles an implementation to the mark.

----

## 14. Moving a node

A household moves its node by exporting it from one host and importing it at another (clauses 43, 52). The export carries the household's offers, settlements, notes, receipts and the lineage edges it is an endpoint of.

### 14.1 A shop leaves with its ledgers

Clauses 5 and 43 say a merchant can leave a platform with its data and that a shop's product ledger and customer ledger are the shop's, exportable in full, in a standard format, at any time. `GET /presenters/{id}/export` is that format:

```
merchant export
  format         "valence-merchant/1"
  presenter
  exported_at
  configs[]      every catalogue version this presenter registered
  offers[]       every offer it made, whatever the state
  settlements[]  how each settled
  notes[]        only the lines households chose to share with the merchant (clause 27)
  recoveries[]   the recovery rows of its own physical offers
```

It carries nothing of another presenter's, and nothing of a household's beyond what this presenter already holds, which is its own vertical view (clause 8). There is no import beside it: where a shop goes with its ledgers is the receiving platform's business, and what this specification owes the shop is that leaving is possible and complete. Added 2026-09-09; until then two clauses promised an export that no route provided.

### 14.2 What an import verifies

An import is an arrival from outside, not a restore of the host's own backup, so it verifies what it is handed:

- **Every edge is verified as if it had arrived at `POST /lineage`** (§7.1): the giver's key is attested and the signature covers the edge. An import that trusts an edge is a route around clause 22, and an edge is what makes a product no longer novel to a household (§5.1), so an unverified edge is also a way to shrink somebody else's exploration floor.
- **Every edge touches the household whose path it arrives on**, as `from` or as `to`. Another household's edges are not this node's to carry.
- **Every offer belongs to that household.** An import scoped only by the path writes other households' offers under it.
- **A settled offer is never overwritten.** §2.1 makes `settled` terminal, and an import that replaces one has moved an offer out of it.

An implementation MUST refuse the whole import with `422` when any of these fails, and MUST refuse an export whose `format` it does not recognise with `400`. Added on 2026-09-09: the reference engine's import verified none of it, and an adversarial pass planted a forged edge that made a product unofferable to a household that had never seen it.

----

## 15. Open

- Binding an AP2 mandate to direct-debit rails. The specification is written for card authorisation; no equivalent exists for account transfer, and one is needed.
- Multi-hop lineage attribution, where a product passes through several households before a purchase. The settlement side is out of scope here.
- Whether the feed extension should be proposed to the ACP community or remain a private extension.
- Default values for the exploration rate, the recovery deadline and the loss threshold. All are currently deployment parameters with no recommended figure.

----

## 16. Mandates

A mandate is the person's standing protections, and clauses 46, 47 and 58 are about what may change in it and who has to sign. Until 2026-09-09 it was a reference an offer carried, so all three were promises.

```
mandate
  id
  household
  ceiling_out_of_network   what one offer may cost at merchants the registry does not list (clause 46)
  co_signers[]             keys named while the person had capacity (clause 47)
  lapses_at                a standing mandate lapses unless renewed (clause 58)
  version                  1 for a new mandate, then one more each time
```

### 16.1 Who signs a change

Every version is signed by the household over the canonical form: the fields above, one per line, in the order listed, with `co_signers` sorted and comma-separated, and the version inside the bytes so that an old signature cannot be replayed onto a new record.

A change **loosens** when it raises the ceiling, pushes `lapses_at` further out, or drops a co-signer. A loosening MUST also carry the signature of every co-signer the **previous** version named. A tightening is the person's alone. An implementation MUST refuse with `422` a version that is unsigned, signed by the wrong key, or missing a co-signer's signature on a loosening, and MUST refuse a version that is not exactly one more than the last.

This is what clause 47 means by "nothing else changes it": not the person alone, not a co-signer alone, and no layer, which holds no key at all.

### 16.2 The ceiling

At presentation, an implementation that holds a mandate for the offer MUST refuse with `422` when what the offer could cost at merchants the registry does not list exceeds `ceiling_out_of_network`, and MUST refuse when the mandate has lapsed. The registry is what "in the network" means (§17); a person's limit on the rest is applied inside their own mandate, which is where clause 55 says an exclusion may live.

An offer whose mandate this implementation does not hold is left alone. A deployment may carry mandates elsewhere, and refusing every offer whose mandate is unknown would be a gate rather than a protection.

----

## 17. The endpoint registry

Added 2026-09-09. A merchant that speaks Valence has to be findable by a household's agent, and clause 1 forbids the infrastructure from being the place where things are found. Those two hold together only if the registry **resolves and does not rank**.

### 17.1 What it is

A shared, neutral directory of merchant endpoints. It answers one question: given a merchant's key, or a protocol, which endpoints exist and where. It is the routing layer clause 2 calls shared and neutral, made concrete.

```
entry
  merchant      the merchant's key identifier, which is the entry's only name
  endpoints     { valence, acp, ucp, ap2, mcp }  each a URL or absent
  mark          whether the merchant carries the Ataraxia mark. Recorded, never required
  signature     by the merchant's key, over the entry
  registered_at
```

### 17.2 What it never does

The line between a directory and the intent layer is whether the answer depends on anything but the question. A registry that returns different results to different askers, or in an order that says something, is ranking.

- **No order that means anything.** A list is returned in key order and in no other. There is no field for rank, score, popularity, relevance, featured, or recommended, and no parameter that sorts.
- **No query by intent.** The registry is queried by key or by protocol. It is not queried by product, category, occasion, price or any word a person would type when they want something. `?q=` is not a parameter and returns `404`, not an empty list.
- **No per-asker answer.** The same query returns the same list to every caller. There is no personalisation and no field that identifies who asked.
- **The mark is not a gate** (clause 55). An entry is listed whether or not it carries the mark. The mark is a fact in the entry, and an agent MAY prefer it, and the registry MUST NOT filter on it unless asked to by the caller.
- **No product data.** The entry names endpoints. What the merchant sells is behind those endpoints, in the merchant's own feed, and the registry does not copy it.

### 17.3 Why the line is here

Discovery in this design is vertical. A household's agent reads merchant feeds through the endpoints the registry resolves, and forms its own view in the household's own node. The index lives with the person. A registry that indexed products would move the index to the centre, and whoever holds the index takes the rent, which is the sentence clause 1 exists to make false.

A registry of endpoints is plumbing. A registry of products, however neutrally it answered, would be the layer that decides what a person sees, and that is the seat this specification returns to the person.

### 17.4 Conformance

An implementation of the registry is conformant when it:

1. lists entries in key order and accepts no sort parameter
2. carries no field from the list in §17.2 on any entry
3. refuses a query by product, category, occasion or free text with `404`
4. returns the same list to every caller for the same query
5. lists an entry that carries no mark

----
