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
  merchant               the merchant of record (clause 11). From the catalogue, never the request.
  maker                  who made it (clause 12). The merchant only where the merchant made the goods. From the catalogue.
  ships                  who carries it to the household (clause 12). From the catalogue.
  category               the merchant's own category, or null. From the catalogue, never the request.
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

**A body carrying a field this specification does not name is refused, with `400 malformed`**, and so is one that does not parse or whose field is of the wrong type. **Strictness is what makes an absence checkable**: a body check that quietly discards what it does not recognise cannot tell a client that sent a discount from one that sent nothing, so the fields above would be absent from the schema and present in practice. The name is written down here because §16.6's discipline reaches every refusal this specification names, decided 2026-09-13, and the suites required this one while no section carried it.

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

**The category is inside the signed bytes of a catalogue**, beside the price, so whoever relays a catalogue cannot strip one. It was put there for §16.4, which read the category and was withdrawn on 2026-09-12; it stays in the signed bytes because what a merchant said a product was is part of what it published, and a protection that a relay can remove is not a protection.

An offer says whether an identity root endorsed that key (`presenter_attested`, §7.1). Where it did, changing name means presenting a second identity to that root, which is a thing the root can see and a household can weigh. Where it did not, the name is the presenter's own word.

**What this does not close, stated plainly.** An operator that can obtain two identities is two presenters as far as this specification can tell, and a household that has seen everything from one can be shown the same range again by the other, with the floor satisfied both times. Only the root that endorses identities can say the two are one. Nothing inside an engine can: it sees keys, and the question is about who holds them. This was measured on 2026-09-09, when an adversarial pass renamed a presenter and watched a household's history disappear.

### 5.3 Why

An engine that maximises the kept ratio stops exploring, removes the household's freedom to decline, and destroys the only output that cannot be obtained elsewhere: which declines predict the market. Selling out is therefore not an achievable state in a conforming implementation (clause 26).

### 5.4 Disclosure

Exploration candidates MUST NOT be concealed. The presentation surface SHOULD indicate that a candidate is one this household has not been offered before. A household MAY reduce `rate` for its own offers. It MUST NOT be able to reach zero.

----

#### Catalogue publication signature revision 2

For revised catalogue publication, the presenter **MUST** sign the UTF-8 bytes of compact JSON with this exact array shape and no trailing newline:

```text
["valence.catalogue.2",version,presenter,[productRow,...]]
productRow = [reference,merchant,maker,ships,price,categoryOrNull,physicalOrNull]
physicalOrNull = null | [ambient,keeps_for_days,fits_ten_per_container,regulated]
```

Product references **MUST** sort by UTF-16 code units without Unicode normalisation. Strings use ECMAScript compact JSON escaping and **MUST** be well-formed Unicode. Required names and an explicitly provided category **MUST** be nonempty. Price and shelf-life days **MUST** be nonnegative integers no greater than 9007199254740991. Eligibility flags **MUST** be booleans. Absent category/physical metadata becomes null. Unknown publication fields **MUST** be refused rather than excluded from signed bytes.

This domain replaces the earlier unversioned catalogue form, which omitted physical eligibility. A revised publisher/verifier **MUST NOT** fall back to that form for a new publication. The request shape need not add a signature-format field: the signed domain fixes the format. Publish the service/client revision together; a signature refusal does not authorise an unsigned retry.

The reference stores its verification-format marker with the catalogue row. A legacy row without that evidence **MUST NOT** be used to create a new offer and **MUST NOT** be silently marked as revision 2. Republish a fresh catalogue version after reviewing eligibility. Already-created offers and historical exports remain readable without rewriting their signed content. A local marker is not an exported authority claim or a replacement for verification on another host.


## 6. Settlement

```
settlement
  offer            reference
  settled_at       timestamp
  kept_amount      sum of unit_price * quantity over kept and defaulted
  consumed_amount  sum over consumed candidates that were not given, at the merchant's price
  lost_amount      sum over lost, informational, not billed to the household
  charged          what the household is actually billed
  disputed_amount  sum over consumed lines the household disputed (§6.5). Not in charged; the merchant's to pursue outside this record
  lines[]          one per candidate charged, disputed or lost: candidate, product, merchant, maker, ships, valence, amount, disputed (clauses 11, 12)
  signed_by        the presenter
  signed_as        "agent". The presenter is not the seller; it signs for the merchants named on the lines (clause 11)
  receipt          signed by the presenter as the merchants' disclosed agent, delivered to the household
  confirmation     the household's signature over the settlement statement (§6.5), or null where none was needed
```

Every line names its merchant of record. A receipt that totals without saying who sold each item has hidden the merchant behind the curator, which clause 12 forbids and clause 11 makes a question of who is liable.

**A settlement is a record and not an instruction to move money.** §1 says this specification does not define payment, and that has a consequence worth stating where the record is defined: `charged` is what the household owes on this offer, and how it is paid is the merchant's own arrangement with its processor. So a settlement whose `lines[]` name more than one merchant of record is well formed, and how many payments it corresponds to is not a question this specification answers.

`charged` **MUST** equal `kept_amount + consumed_amount`, and it is what the ledger commits.

The field is not redundant, and it was added on 2026-09-08 after a conformance probe failed to catch an implementation that billed for `lost`. Without it the settlement reports a breakdown and the ledger takes a number, and nothing in the record connects the two: a household reading a receipt that says nothing was kept has no way to see that it was charged anyway. An implementation whose `charged` disagrees with the sum above is not conformant even when every other amount is right.

### 6.1 Nothing accrues

Nothing carries from one settlement to the next. There is no balance, and since 2026-09-09 there is nothing to deduct either: every line settles on one of the two bases in §6.2 and there is no third. An implementation MUST NOT hold a household balance redeemable against future goods, which is a prepaid payment instrument in several jurisdictions and out of reach for most implementers.

An earlier wording of this paragraph said a trial "is a sample, which is free, or it is goods, which are bought at the merchant's price". That was a third basis, asserted three lines above the sentence in §6.2 denying that a third exists, and it used the word the model deliberately does not carry: goods received as a sample read as a promotion and as worth less than their price, which is why a candidate carries a giver (`given_by`) and never a sample flag.

### 6.2 What was used is bought; what was given is a gift

Two bases exist and no third. A candidate the collection records as `consumed` settles at the merchant's price, the same price the household would have paid to keep it: using something is buying it, which is the rule of 先用後利 (use first, settle after). A candidate that carries `given_by` was given, by a maker, by a merchant or by a friend, and **a gift is never billed to the person who received it**: its line settles at zero and names the giver. What the giver owes the merchant is settled between them, in flow C, where the recipient never sees it.

**No cost of goods is ever quoted to a person, and no field carries one.** An earlier version of this section charged `consumed` at the presenter's cost basis, so that trying was "neither free nor full price". Two things were wrong with it. A cost basis in a household's receipt tells a person what the maker paid and prices the same goods two ways. And the middle term reads as a discount, which is what clause 10 removes everywhere else, a price being the merchant's and the same to everyone; clause 28, which this line cited until 2026-09-11, removes discount codes and defers the general rule to clause 10 in its own text. goods that are normally sold at a price are not quietly worth less because a household is trying them. A maker that wants a person to try something gives it, at the price it is worth, and the record says who gave it. The catalogue has no `cost` field.

A gift arriving this way is the same event as a gift between people (§7): whether a lineage edge exists for it is the giver's business, since an edge carries the giver's signature and a presenter cannot make one on their behalf.

**A gift has a value, and it is the price the catalogue gives the product.** Several jurisdictions cap what a seller may give beside a sale, and the cap is the seller's law rather than this document's business, in the same way §10a leaves the disclosure's contents to the seller. What this specification supplies is the measure: **the value of an offer's gifts is the sum of its gift lines at their catalogue price**, and there is no second measure. A version of this paragraph that stood for an afternoon on 2026-09-12 said a gift in a unit never sold measured as nothing, resting on `valence.gift_unit`; that field exists in §8's prose and in no type, route or probe, and the lane it named would have let a presenter relabel the product itself. An implementation MUST NOT add a field that declares a gift a sample or a trial, and MUST NOT price a gift line at anything but the catalogue's price for the product.

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

### 6.5 A physical box with goods used settles on the household's signature

Added 2026-09-12. **The collection's record is a proposal, and the household's signature over the settlement statement is the application.**

§11.2 makes `consumed` a fact the collection records and forbids a household to name it, for a reason that stands. What this section adds is what that fact is allowed to do on its own, which is nothing. Until this section existed the reference charged a physical box's consumed lines on the collection's record alone, through a settle call with an empty body, with no act of the household on any device. That is a debt made by a third party's record, which clause 35 forbids in terms, nothing settles on a set other than the one signed, and which the concept documents' own legal reading says loses the case for the sale being concluded at a distance rather than in the home. The digital binding never had the defect: its settlement charges lines the household signed at the decision.

**What is signed.** A domain tag, the offer id, the carriage, then one line per kept, defaulted or consumed candidate, in ascending candidate id, UTF-8, `\n` between lines:

```
valence.statement.1
<offer id>
<carriage>
<candidate>:<valence>:<amount>:<"disputed" or empty>
```

**The carriage joined the signed bytes on 2026-09-13, and question 40 is why.** It is the one item 法11条1号 puts on this screen beside the price, and until then the signature covered the lines and not it: a household read 「Carriage: ¥500」, signed, and had no record anywhere that it had. The register was taught the same day to refuse a second record naming a different figure, which stopped the number moving and left the gap it moved in. **The alternative, leaving it out, was refused for the shape it shares with the worst defect this specification has had**, where the document a household signed read one figure and the ledger committed another.

**It is a whole number here and never null.** This section already refuses to settle a statement with no delivery recorded (`delivery_missing`), so by the time these bytes exist there is a figure, and the `null` that means "nothing was ever recorded" cannot reach them. A merchant whose price includes carriage records `0`, and `0` is signed as `0`.

**`charged` still excludes it**, which is the other half of the decision: what is signed is what the household agreed it was shown, and what is charged is the goods. A screen MUST say which of the two a total is, and the reference says the carriage is not in the figure.

**Any signature made over the previous form stops verifying**, which is the right failure rather than a silent one: the bytes differ, so the check fails as `bad_signature` and nothing is charged. The tag is unchanged, because its job is to separate a statement from a decided set and not to carry a version. **The cost was named before it was paid**: this was one line while no signature over the old form existed anywhere, and it is a migration once one does.

**The tag is load-bearing.** A decided set is signed as the offer id then `<candidate>:<valence>:<kept_as>:<lineage>` (§10.5): the same prefix, the same four-field shape, and the two are told apart today only because a decision's third field is a word and a statement's is a number. A future valence, or a numeric `kept_as`, would make one signature verify as the other. It costs a line now and cannot be added once signatures are in the wild.

`amount` is the line's own, `unit_price × quantity`, or 0 for a gift (§6.2). Lost lines are not in it; they are never charged (§3.2). A household confirms the statement as proposed, or marks consumed lines `disputed` and signs the rest; it may not add, remove or revalue a line, and the two shapes of §10.5 apply, a signature over these bytes or an assertion whose challenge is their SHA-256, by the key registered for the offer's mandate.

**What an implementation MUST do.**

- `GET /offers/{id}/statement` MUST return the statement as proposed: each line with its candidate, product, merchant, maker, carrier, giver, valence, quantity, unit price and amount, **the offer's expiry**, the merchants' blocks beside them **as composed** (§10a.2), the carriage from the delivery record where one exists (§7.5b), and the challenge for a passkey. It is data and never presentation (clause 54); the hub draws it. The expiry is here for the reason §10a.5 puts it on the approval: a merchant's stated application period is measured against something, and a screen that omits it states a period against nothing.
- `POST /offers/{id}/settle` on a physical offer whose collection recorded any consumed line MUST refuse, with `422 statement_unsigned`, unless the body carries a signature or an assertion over the statement, and MUST refuse with `422 bad_signature` one by another key or over other lines. Nothing is written on refusal. The settlement records the signature as `confirmation`.
- **A disputed line leaves the rail.** It is not charged, `charged` still equals `kept_amount + consumed_amount`, and the line is returned with `disputed: true` and its amount under `disputed_amount`. Only a consumed line can be disputed; `422 not_disputable` otherwise, since a kept line is one the household signed itself.

  **Whether anything is owed for it is not this specification's to say, and a sentence here said it was.** It read that the amount is "the merchant's to pursue under whatever agreement stands between them", which a refutation pass on 2026-09-12 took apart: on the concept documents' own reading either the framework agreement contains the sale, which they forbid because the Act would then reach the framework itself, or it does not, and a line nobody applied for is not a sale and there is nothing to pursue. This specification defines a record and not a claim (§1), so it says what the rail does, which is nothing, and leaves the rest to the parties and their law.
- **This presenter's next box does not come while its own statement stands unsigned.** `POST /offers/{id}/present` on a physical offer MUST refuse, with `422 statement_unsigned`, while an earlier physical offer **of the same presenter to the same household** has a collection recording consumed lines and no settlement. Nothing accrues on the rail.

  **The scope is the presenter's own offers, and clause 8 decides it rather than convenience.** A merchant holds what was declined to it and nothing declined elsewhere, and no party but the person holds the union. A block computed across presenters is an engine computing that union and answering a merchant out of it, which is the objection §16.3 already records against the daily ceiling; suppressing the waiting offer's id does not cure it, because what a presenter learns is that something is unsettled somewhere else. It is also the only scope that means the same thing under §13.1, where each engine holds its own offers and a cross-presenter block silently reaches nothing. **The cost is stated plainly**: a household that does not settle with one merchant goes on receiving boxes from others, which is what a debt between two parties ordinarily does.

  **Only a box the household can settle now counts**, which is one in `decided` or `expired`. A refutation pass on 2026-09-12 measured both ends of the alternative and both are worse than the block is worth. An offer still `presented` after a partial collection refuses `settle` with `409`, so counting it makes a block the household is forbidden to cure. And an offer a presenter withdrew after a partial collection can never be settled at all, so counting it made that household unofferable, by every presenter on that engine, permanently.

  **The refusal names its rule, not a waiting offer.** It carries `statement_unsigned` and does not disclose an offer id. The block applies only to this presenter's own earlier boxes, as specified above; it does not report another presenter's outstanding statement.

- **A physical box with goods used does not settle without a delivery recorded.** `POST /offers/{id}/settle` MUST refuse, with `422 delivery_missing`, where the statement is required and the hub holds no delivery for the offer. The statement is the screen this application is made on and 法11条1号 asks for the carriage beside the price 「販売価格に商品の送料が含まれない場合には」: **a merchant whose price includes carriage owes no separate figure and records `0`, and `null` is an implementation that never recorded what it did.** The two are the same picture on a screen and different facts, and for a statement the goods have by definition been delivered and collected, so there is a delivery to record. A box that came back with nothing used settles without one, because nothing is charged and no application is made at settlement.

- **A waiting statement stands on the household's own surface, and it is not a reminder.** From the moment the box can be settled until the statement is signed, the hub MUST show that household that a statement is waiting and MUST make it reachable.

  **That is when the box leaves `presented`, and this requirement said "from the moment a collection records a consumed line" until 2026-09-13.** §11 allows a partial collection, which leaves lines the household has still to answer and leaves the offer `presented`, and `settle` refuses an offer in `presented` with `409`. So the earlier wording asked a hub to put in front of a household a statement it cannot sign, beside an approval it can. Measured on 2026-09-13 against the reference: `GET /offers/{id}/statement` answers `200` for a half-collected box, and `POST /offers/{id}/settle` answers `409 bad_state`. **The screen the household needs while any line is open is the approval**, which carries the consumed lines as resolved and says they return on the statement; the statement's own turn comes when nothing is left to answer. The reference hub had this right and the specification did not, which is the opposite of the usual direction and is why it went unnoticed. **The refusal above then falls on a household that has had the thing in front of it**, rather than on one that learns only that a box stopped coming.

  **The reminder is the wrong instrument and this is why.** An approval expires, so a household that does nothing loses the chance, and one timed nudge is the right answer; clause 33 caps it at one. A statement does not expire. Nothing is lost by waiting and the consequence is that deliveries stop, which is a state rather than a deadline, so a nudge would delay the silence by one interval and not remove it. What the household needs is not to be told once but to be able to see, at any moment, that something is waiting for it.

  **The enforcement gap is named rather than papered over.** This is a requirement on the hub's surface, and §13 condition 16 binds the engine's behaviour, so a hub-only implementation is asked nothing here, exactly as condition 15 already admits for the approval. An implementation can conform and still leave a household wondering why no box came. Clause 33's reminder is untouched and keeps its own subject, which is an offer awaiting a decision.
- A physical box whose collection found nothing used, and every digital offer, settle as before, with an empty body and `confirmation` null: every charged line was signed at the decision.
- **A signature over a box that has already settled is refused, with `409 already_settled`, and never answered with the settlement that stands.** Settling is idempotent for a caller that only asks for it, and a presenter retrying after a timeout MUST get the recorded settlement. A household sending a signature is not asking, it is applying, and handing it the earlier settlement tells it that the set it signed went through. Two tabs of one statement, the second disputing a line: the second signature was discarded, the screen read as signed and named the first settlement's charge, and the dispute was recorded nowhere. Added 2026-09-12 by a refutation pass over the reference hub.

**The cost is named rather than hidden.** A household that used goods and never signs is not charged by the rail, and what it owes is the merchant's to pursue. That is the price of the sale being the household's act rather than the collector's, and the merchant-side platform this specification was written beside had already accepted it before this section was written: its charge refuses without the settlement the household signed for. **The alternative considered and refused** was a clause in the approval, that whatever the collection finds used is bought at the listed price, which satisfies a disclosure statute on its face and signs a rule rather than a set: the household would see the amount after the charge and dispute after it, which is exactly the order clause 35 exists to prevent.

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
  maker       who made it (clause 12). Inside the signed bytes, like every other field here
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

**And the protection has a second half, which was assumed rather than written until 2026-09-13.** The reads under an offer's path say what a recipient did with a gift: `GET /offers/{id}/statement` lists the lines a collection found used, `GET /offers/{id}/approval` names every candidate and the giver. Neither is a giver's surface, and the schema of the giver's surfaces is clean; **what keeps a giver away from them is that nothing hands a giver an offer id.** A giver's own surfaces deal in edges, a ceremonial offer is created by the presenter, and a lineage edge carries a receipt hash and no offer reference.

So an implementation **MUST NOT put an offer reference on any giver-facing surface**, and that is checkable where the older sentence was not. §12 already shut the one route that would have: handing a giver the settlement statement of a ceremonial box. The rule generalises it.

**What is left over is not this section's**, and a refutation pass on 2026-09-12 was right that the section reads as though it were. The reference engine authenticates nobody, so a party that obtains an offer id by any means reads everything under it. That is clause 53's open half, which `08` §3 of the concept documents records and which proving needs a conforming host that authenticates reads. **This section binds the shape of a response and the shape of a surface; it does not and cannot bind who may ask.**

**Whether a conforming implementation owes an authenticated read is decided, 2026-09-13, and the answer is not yet.** It would reach every route in this document, and it is the one change that would let clause 53 be proved rather than asserted, so it is worth doing **at the moment somebody is certified against it** rather than now. What it costs to defer is stated plainly here so that nobody reads the deferral as an absence of the problem: **an implementation can conform to every word of this document and still answer a stranger who holds an offer id.** §15 carries it as an open question, and the concept documents' `08` §3 records it as the half of clause 53 that enforcement cannot reach from above the API. **What made deferring defensible** is the half that was closed instead: nothing in this specification hands a giver an offer id, and since 2026-09-13 nothing may.

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

### 7.5b Carriage and delivery, which the household sees and the merchant does not

Added 2026-09-10. Two things belong on a household's surface and on no merchant's: **what carriage costs, and where the parcel is.**

```
delivery
  offer
  carriage      what carriage costs on this offer, in the smallest unit
  code          the delivery code of clause 49
  status        placed | in_transit | delivered | returned
  updated_at
```

`GET /offers/{id}/delivery` returns it to the household. **It is not on the offer, not on the settlement, and not in `valence-merchant/1`.** An implementation MUST refuse `code` and `status` as request fields on any merchant-facing route, and MUST NOT carry them in the merchant export (§14.1).

**The status moves and the carriage does not.** A second `POST /offers/{id}/delivery` for the same offer MUST be accepted where it advances the status and MUST be refused, with `422 carriage_fixed`, where it names a different carriage. The figure is one the approval (§10a.5) and the statement (§6.5) put in front of the household before it signed, and a despatch update carrying another one rewrites what a person read after they read it. The register took a plain overwrite until 2026-09-12, so a household that signed under a carriage had no record anywhere that it had. **The signature covered the lines and not the figure until 2026-09-13**, which was the open half of this and is question 40's answer: the carriage is inside the bytes a household signs (§6.5), so a settlement signed against one figure no longer verifies against another. This rule and that one are the two halves of the same guarantee, and **neither is sufficient alone**: the canonical form makes a swapped figure fail verification, and this refusal stops the swap from being recorded at all, which is what a household reading the register afterwards needs.

**Why the merchant is on the other side of this line.** Clause 49 keeps identity from the merchant, and a carrier's tracking number is a lookup key into the delivery address: a merchant holding one can read where the household lives from the carrier, without ever having a field for an address. The absence of the field is not the protection; the absence of anything that resolves to it is. This is an inference channel of the kind `04b` of the concept documents catalogues: not one of its eight by name, but the shape its last one warns about, two surfaces differenced, where a code that is harmless on its own resolves against a carrier's and gives an address.

**What the merchant needs instead, and already has.** A presenter learns what happened to the goods from the state machine and the recovery, not from a carrier: `present` ships, §11 records what came back, and settlement prices what was kept. Nothing in that path wants a tracking number.

**Carriage is on this surface and not on the candidate.** Clause 10 keeps the price the merchant's and clause 4 keeps a person-side fee from being a function of what was bought, so carriage is neither a price nor a fee here: it is what the shop is charged and shows, quoted to the household on its own line before it decides. `17` §2b of the concept documents holds the shape.

### 7.6 The recipient's record

A recipient's node records the fact of receipt and nothing else until that household becomes a giver (clause 19). No preference, no profile, no score is derived from having received.

### 7.6b A note is the writer's, and nothing here helps buy one

Added 2026-09-12. **A household that receives a gift may write a line about it (clause 27), and a maker that gave the gift is a seller.** Japan's 「一般消費者が事業者の表示であることを判別することが困難である表示」 (令和5年内閣府告示第19号, in force 2023-10-01) makes a seller's own display that a consumer cannot tell is the seller's an unfair display, and its 運用基準 puts the test at whether 「客観的な状況に基づき、第三者の自主的な意思による表示内容と認められない場合」. **Two of its examples reach this system.** A seller that gives goods 「表示してもらうことを目的に」 and receives a display along its own lines has made that display its own; so has one that lets a third party infer, 言外 or 言動から, that writing brings 「経済上の利益」, which the guideline's own note says is not only money but 「対価性を有する一切のもの」. **The next gift is such a thing.** The escape the guideline names is narrow and exact: a reward does not make the display the seller's where 「投稿（表示）内容について情報のやり取りが直接又は間接的に一切行われておらず」 and the content was the writer's own.

**So the rule here is about what this specification does not carry**, and it has three parts, each checkable.

- **Gift eligibility is a property of a product and never of a household.** `valence.gift_eligible` is a field of the merchant's feed (§8). No route accepts, stores or returns a per-household eligibility, and an implementation MUST NOT add one. A maker that could mark a household eligible could mark it eligible for writing.
- **The reasons an agent may exclude a candidate are the closed list in §10**, and none of them is about what a household has written. Extending that list is a change to this document, which is what keeps a routing rule readable; a rule named for a note would be the inference the 告示 forbids, written into the protocol.
- **No field carries a request for content.** A candidate carries no brief, and `POST /candidates/{id}/note` takes the writer's own author, text and audience and nothing from a merchant. An implementation MUST refuse a body with any other field, which §3.3's strictness already does and which this names so that nobody adds one later.

**What this cannot do is stated rather than implied.** A merchant reads the lines a writer chose to share with it (clause 27), so it can see who wrote. Whether it then gives again to those households is its own conduct, outside this system and invisible to it, and it is the merchant's liability under the 告示 rather than the hub's. Clause 16 removes the other half, since the absence of a note never reaches the giver. **The specification's claim is only that nothing here helps**, and a reader who wanted the stronger claim would have to remove clause 27's sharing, which is the writer's own choice and not this document's to take.

### 7.7 Display

Lineage is displayed as density within the viewer's own circle. Totals, network size and popularity rankings MUST NOT be displayed (clause 21). The merchant is never hidden.

----

## 8. Feed extension

A Valence-conformant merchant extends its ACP product feed. The gift fields were named `valence.sample_unit` and `valence.trial_eligible` until 2026-09-09: the same goods, described as a sample, are received as a promotion and read as worth less than their price, and described as a gift are received at their price from someone who chose to give them. The field names follow the thing rather than the trade's habit. **A `valence.gift_unit` row stood here until the evening of 2026-09-12**, naming a unit in which a product could be given rather than sold; §6.2 forbids exactly that field, a lane relabelling the product itself, and the row is removed rather than left as a contradiction.

| field | meaning |
|---|---|
| `valence.gift_eligible` | whether the maker allows it to be given. **A property of the product and never of a household** (§7.6b): an eligibility a maker could set per household is one it could set for writing |
| `valence.gift_meta` | wrapping options, ceremonial eligibility, price band |
| `category` | the merchant's own category for the product. It travels into the catalogue and onto the candidate. A mandate named values of it until §16.4 was withdrawn on 2026-09-12; nothing in this specification reads it now, and it is published because it is the merchant's own description. The specification does not define a vocabulary: a hub that ranked or interpreted categories would be judging merchandise, which clauses 1 and 44 remove |
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
POST   /offers/{id}/settle          price, commit, return a signed receipt. Carries the household's signature over the statement, and its disputed lines, for a physical box with goods used (§6.5)
POST   /offers/{id}/withdraw        revoke, release
POST   /offers/{id}/remind          the one reminder (§10.4, clause 33)
GET    /offers/{id}                 one offer, with its candidates
GET    /offers/{id}/statement       the settlement statement a household signs, as proposed by the collection's record (§6.5)
GET    /offers/{id}/settlement      the settlement, once there is one
GET    /offers/{id}/delivery        carriage and where the parcel is (§7.5b). The household's surface, never a merchant's
GET    /offers?household={id}&presenter={id}   the presenter's vertical view, and only that presenter's (clause 8)
POST   /candidates/{id}/note        one line, shared with whom the writer says
GET    /candidates/{id}/note?as=    the lines shared with that party (clause 27)
POST   /lineage                     accept an edge
POST   /_identities                 a public key: a presenter's, a household's or a recipient's (clause 2, §13.2)
POST   /households/{id}/offers      the person's copy of a decided offer, sent by the engine (§13.2)
POST   /households/{id}/settled     the person's copy of what settled, an amount and a date (§13.2, §16.3)
GET    /households/{id}/settled?since=  what has settled for this household since a moment, as a total
```

The same operations SHOULD be exposed as MCP tools, so that a merchant's agent and a household's agent call the same surface.

Three of these lines were corrected on 2026-09-08, after the conformance suites were written and found to require a surface this section did not describe.

- **The reserve moves from `POST /offers` to `POST /offers/{id}/present`.** The earlier text put it on creation, which contradicts §6.4's table and orphans a hold every time the exploration floor refuses an offer.
- **`POST /offers/{id}/remind` and `GET /offers/{id}` are named.** Both were required by the specification's own prose, §10.4 and §2.1, and neither appeared here. An implementation built from this section alone had no route for the one reminder clause 33 permits, and no way to read back the state the state machine describes.

A fourth line was added on 2026-09-09. **`GET /offers/{id}/settlement`** reads a settlement back. §6 delivers a signed receipt to the household in the response to `POST /offers/{id}/settle` and gave no way to ask for it again, so a household that lost that response had lost its receipt, and clause 43's export could omit settlements while every read still agreed. A conformance probe comparing two hosts found it: the export dropped the settlements and the hosts still answered alike, because nothing asked.

Three more were added on 2026-09-11 with §13.2, and they are the ones a deployment presenting a single role cannot do without: they are how the person's side comes to hold what is the person's. A deployment presenting both roles reaches the same state in process and need never call them, which is what the reference does.

**`GET /offers/{id}/statement` was added on 2026-09-12 with §6.5**, and `POST /offers/{id}/settle` gained a body the same day: a physical box with goods used had settled with no act of the household, and the statement is the screen that act is taken on.

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
   | `late_price` | the price rises at checkout, by carriage or a fee not shown with the candidate. **No live clause names this**, and the parenthetical said clause 48 until 2026-09-11: clause 48 names exactly three detections, auto-renewing subscriptions, obstructed cancellation and manufactured scarcity, and a late price is none of them. The authority is §7.5b of this specification, which the rest of this row already says. This bites inside the network as well as outside it. An earlier version of this row said clause 10 prevents it inside, which is a join of two true things into a false one: clause 10 forbids a curator, a representative or a platform raising the merchant's price, and says nothing about a merchant adding carriage at its own checkout. What prevents it is the requirement that carriage appear as a line of its own beside the candidates, with the terms of consolidation, before the person decides. That was **old clause 54** until 2026-09-09, when it was withdrawn as a requirement on a surface rather than a prohibition. **It is §7.5b of this specification since 2026-09-10**, where the delivery carries the carriage on the household's side and the merchant is on the other side of the line |
   | `outside_mandate` | the candidate falls outside the mandate the household gave |
   | `declined_before` | the household returned this product before, and the agent is not offering it again |

   An implementation MUST refuse a deliberation whose reason is not in this list, with `400`. Adding a rule is a change to this specification, which is what makes an agent's routing auditable: every exclusion a person sees names a rule they can read here.
3b. **Disclose.** The screen a person decides on carries, for each merchant with a candidate in the offer, **a block of that merchant's own disclosure**, rendered as the merchant composed it, **and beside each candidate the quantity and unit price the offer already holds, with the offer's expiry and the carriage from the hub's delivery record**. See §10a.

3c. **Say which lines are still the household's.** Each candidate of `GET /offers/{id}/approval` MUST carry its `valence`. `offered` is a line waiting on the household; anything else is one a collection or an earlier decision has already resolved, and `POST /offers/{id}/decisions` refuses it with `409 already_decided`.

   **A physical box is collected line by line and the offer stays `presented`** (§11), so an approval routinely carries both kinds at once. Until 2026-09-12 the surface rendered every candidate identically with nothing to tell them apart, and a hub that asked for a choice on each could never confirm the lines that were still the household's: the member read a refusal naming a candidate id and had no way forward from that screen. Found by a refutation pass over the reference hub.

4. **Decide.** Per candidate. One tap to confirm. At most one reminder (clause 33).
5. **Sign.** The decided set is signed as an AP2 mandate, and `POST /offers/{id}/decisions` carries the signature beside the decisions (clause 35). What is signed is the set in this canonical shape, so a signature made by one hub verifies at any conforming endpoint:

   ```
   <offer id>
   <candidate>:<valence>:<kept_as or empty>:<lineage or empty>
   ```

   one line per decision in ascending candidate id, UTF-8, `\n` between lines; the signature is over those bytes, base64, by the key registered for the offer's `mandate`. **A signature is verified by the type of the key it is checked against**: ed25519 over the bytes as they are, ECDSA on P-256 (ES256) or RSA (RS256) over their SHA-256. This said ed25519 alone until 2026-09-11, and it refused the key most devices carry: a member who joined through a hub holds a passkey, which is P-256 on almost every phone and laptop, and that member could register a key and then confirm nothing with it and sign no change to their own mandate (§16.1). The same rule reads every signature this specification names. An implementation MUST refuse, with `422`, a decided set with no signature, a signature by another key, or a signature over a set other than the one sent; nothing is written on refusal.

   **A passkey cannot sign those bytes, and the concept documents assume it does.** Found on 2026-09-11, while building the member's side. An authenticator signs the concatenation of its own `authenticatorData` and the SHA-256 of `clientDataJSON`, never bytes a caller hands it, so a signature made by a password manager over this canonical form does not exist. `04` §2.1 of the concept documents said the hub asks a manager for a WebAuthn signature and nothing else, `12` called the mandate "signed with a passkey (the SPC pattern)", and `05` said the same of an individual mandate. As written, an implementation that followed them could not conform. **All three were corrected on 2026-09-11**, each keeping the sentence it used to carry, and this paragraph is kept because the correction is the finding: the documents described the thing every payments article describes, and the thing does not exist.

   **So a decided set carries one of two shapes**, and an implementation MUST accept both.

   | shape | what is sent | how it is verified |
   |---|---|---|
   | `signature` | a signature over the canonical bytes, base64 | against the key registered for the mandate, by that key's type |
   | `assertion` | `authenticator_data`, `client_data_json`, `signature`, base64 each | the `challenge` inside the client data equals the base64url SHA-256 of the canonical bytes, and the signature covers `authenticator_data` concatenated with the SHA-256 of `client_data_json`, by the key registered for the mandate |

   **The canonical form is what is signed in both**, once directly and once as the challenge. That is the whole reason the challenge is not random here: a random challenge proves a person was present and says nothing about what they agreed to, and clause 35 is about what they agreed to.

   The conformance suites exercise both, and build the second themselves rather than asking for an authenticator, because a suite that needed one could not run anywhere. A member's device produces it for real.

   **What the second shape is checked for.** Written on 2026-09-11, replacing a paragraph that listed three things the reference did not check; two of them it now does.

   - **The flags.** An implementation MUST refuse, with `422`, an assertion whose `authenticator_data` does not say the person was both present and verified. A device that signed with nobody at it, or without checking who was, proves that a key was used, and clause 35 asks that a person agreed. The flags are the byte at offset 32, `0x01` for present and `0x04` for verified; every other bit is the authenticator's business.
   - **The relying party.** The first 32 bytes of `authenticator_data` are the SHA-256 of the name the device signed for. An implementation MUST compare them against the name its deployment declares for itself (§14b) and MUST refuse an assertion made for another, however good its challenge and its signature. The name is the hub's, so on a split deployment the engine is told it, which is one more thing on §13.1's interface. It has no default and an engine without one MUST refuse to start: a shape this specification requires an implementation to accept is not a shape it may switch off.
   - **What is still not compared** is the `origin` inside the client data. The relying party hash is the authenticator's own statement of where it signed and the origin is the client's, so the hash is the one that is checked. What that gives up: an assertion made at any origin under the same relying party id verifies, which for a deployment that declares a parent domain means a sibling host's page can confirm a set. A deployment declares the host it serves the hub on, and not a parent, unless it means exactly that.

   **A confirmation is used once.** An implementation MUST refuse, with `422 confirmation_reused`, a confirmation of either shape that it has already accepted for that offer. Found by an adversarial pass on 2026-09-11 and measured: the canonical form binds a decided set to an offer and to nothing else, so after a person took a set back inside its cooling window (§16.5), sending the same bytes again put it back. Anything that saw the confirmation once, the hub that carried it included, could undo the withdrawal. The cost is named rather than hidden: ed25519 signatures are deterministic, so a person who withdraws and then confirms the byte-identical set with a bare signature is refused and has to change a line or sign again with a device whose signature differs. **What this does not do is bind a confirmation to a moment.** A nonce or a version inside the canonical bytes would, and that is a change to what every implementation signs, so it is in §15 as an open question rather than settled here.

6. **Order.** Kept candidates proceed to an ACP checkout session.

   **§1 says this specification does not define payment, and this note does not start.** It records the one property of that checkout the constitution leans on, so that a reader does not have to find it twice. Constitution clause 49, as amended on 2026-09-11, says nothing sent to a merchant on a person's behalf can be used to charge that person again. In the digital binding what is sent is a delegated payment, and the Delegated Payment Spec (developers.openai.com/commerce/specs/payment, read 2026-09-11) says it is **single-use**, with an allowance whose `reason` is an enum of one value, `one_time`, described as "should not be used again for other flows. Usage upto max amount", bound to one `checkout_session_id`, one `merchant_id`, a `max_amount` and an `expires_at`.

   **Two things follow, and only the second is this specification's.** The property clause 49 needs belongs to the payment spec and is enforced by the merchant's own processor, so an implementation that conforms here still owes nothing about payment. And **"single-use" is the payment spec's word rather than a count this specification can check**: the allowance says usage up to the maximum amount, which is a weaker sentence than one authorisation. Where a deployment wants the stronger property it asks its processor, and the concept documents record that conversation rather than this file.

Drafting from history alone converges on last week's order. The exploration floor is what prevents it; trial candidates are what fill the floor.

----


----

## 10a. The merchant's disclosure, which the hub renders and does not compose

**Every jurisdiction makes a seller tell a buyer certain things before the buyer commits, and none of them makes the seller's software house tell them.** This specification does not say what those things are: the list is the seller's law and not this document's business, in the same way §5 publishes no exploration rate and §16.4 named no categories. What it says is **who composes the text, who may change it, and what happens when it is missing.**

```
disclosure
  merchant     whose disclosure this is, matching a candidate's merchant
  product      null for the merchant's standing text; a product reference for a block about that product alone (requirement 5)
  version      the merchant's own version of this text
  items[]      label and value, in the merchant's own order
  signature    by the merchant's registered key, over the canonical form
```

The canonical form is the merchant, the version, the product (empty for the standing text), and then each item as `label` and `value`, **every part percent-encoded** before the separators join them, for the reason §8 and §16.1 escape theirs: a plain join lets whoever relays the block move the boundary between two fields under a signature that still verifies. The product is inside the signed bytes so that a block signed for one product cannot be re-filed under another, or under the merchant as a whole.

**The requirements are five, and each is checkable.**

1. **A disclosure is the merchant's.** An implementation MUST take it from the merchant's registered disclosure and MUST NOT take any part of it from the request that creates an offer or from the request that decides one. A field through which a caller can write a seller's legal text is the same defect as a field through which a caller can write a price (§3.1).
2. **It is rendered as composed.** An implementation MUST return the items as the merchant signed them, in the merchant's order, without adding, removing, reordering, translating or summarising. **A hub that summarises a disclosure has composed one.**
3. **An offer without one is not presented, and a decision without one is refused.** `POST /offers/{id}/present` MUST refuse with `422` and the reason `disclosure_missing` when any candidate names a merchant for which the offer carries no disclosure. `POST /offers/{id}/decisions` MUST refuse the same way when a candidate in the decided set names one, or names one whose signature does not verify.

4. **The person sees it before they sign, not after.** It travels on the offer, so `GET /offers/{id}` carries it **and so does `GET /offers/{id}/approval`, which is the screen a person signs from**; an implementation that returns it only with a receipt has disclosed after the commitment, which is the one thing the requirement exists against. **The second half of that sentence was missing for the first hours of this section's life**, and the probe written for it read the offer rather than the approval: the requirement was satisfied on a surface no member's hub reads. A requirement is only as good as the surface it is checked on.

5. **A block is the merchant's standing text, and the screen is what discharges the duty.** A disclosure is keyed on the merchant and is registered before any offer exists, so it can carry only what the merchant knows in advance. **The facts of the particular sale come from the offer**, which already froze them at creation against the presenter's catalogue: the quantity and the unit price of each candidate, and the expiry. **That catalogue is the presenter's and not the merchant's**, registered at a route this engine marks out of specification and verified against the presenter's key, and a version of this sentence said the merchant had signed it. So the price on the screen is the presenter's assertion of the merchant's price, which is the merchant speaking through its own contractor where the presenter is its platform and is not the seller where it is not; **and from the hub's own delivery record (§7.5b), the carriage**, which the offer does not hold because a merchant must not. An implementation MUST render the quantity and the unit price per candidate beside that candidate's merchant's block on `GET /offers/{id}/approval`, and MUST render the carriage there whenever a delivery is recorded for the offer, as `carriage`, null until one is. **A screen that shows the block alone has shown standing terms and not a sale.**

   **This requirement exists because the first version of this section got the diagnosis wrong.** A refutation pass on 2026-09-12 found that a block keyed on the merchant cannot carry 法12条の6第1項1号's 「当該売買契約に基づいて販売する商品……の分量」, which is per contract and per product, and the conclusion drawn was that the key was wrong. It is not: what the provision requires is that the items **appear on the screen**, not that one signed object carry all of them. **Rekeying would have cost what it does not buy.** Per merchant and product still misses the quantity, which is chosen when the offer is made. Per merchant and offer carries everything under one signature and forces a merchant to be able to sign while an offer is being assembled, which a shop hosted on somebody else's platform cannot do. The Japanese provision is named here as the worked example and not as the rule: **the general form is that standing facts come from the block and per-contract facts come from the offer.** Two things the refutation pass of 2026-09-12 added. A block keyed on the merchant cannot carry a term that differs between that merchant's products, and a strict term displayed against a product with better terms is a misleading display for which the merchant is liable and the household loses a statutory right; **so the key admits an optional product**, taken the same evening. A block carrying `product` is about that product alone and carries only the items that differ for it. An implementation MUST store it beside the merchant's standing text and never in its place, MUST attach it to an offer only where a candidate names that product, and MUST NOT let it satisfy requirement 3, which asks for the standing text. On the screen the product block is rendered adjacent to that product's line, and where a label appears in both blocks the product block's item prevails for that line and the standing text's for every other; the two blocks are shown as signed, not merged, so that what a person read is what a merchant signed. **Which block governs which line is named on the line**, as `disclosure: { merchant, product }` on each candidate of the approval and each line of the statement: the merchant's block for that product where the offer carries one, and its standing text otherwise. Added 2026-09-12, because the rule was a rendering instruction in prose and no probe could reach it, so a hub could pair any block with any line and pass everything. **What stays the hub's is the visual adjacency**: the field says which block, not where on the screen it sits, and condition 15 already admits that half. It costs the merchant nothing the standing block does not already cost, one signature before any offer exists. And one screen carries several merchants' blocks, so each merchant's block is rendered adjacent to that merchant's own lines and to nothing else.

**Why this is here rather than in the merchant-side platform.** The duty is the seller's, and the surface is the person's agent's. A specification that left the join to each deployment would leave the person's agent free to decide what a seller's notice says, which is a party that is not the seller speaking as the seller. **No clause is cited for that here on purpose.** Two were on 2026-09-12 and a refutation pass took both the same day: clause 45's subject is the hub, which is the person's agent, and clause 11 makes a curator a disclosed agent for the act of signing a receipt and for nothing wider. The requirement below stands on its own reasoning. **The hub is a contractor for rendering and never an agent for composing**, and clause 54 is satisfied because a party that renders a statutory notice is a party to no transaction.

**What this does not do.** It does not check that a disclosure is complete, or true, or in the right language, because none of those is decidable here: the list is the seller's law. An implementation that carries an empty `items[]` signed by the merchant satisfies every requirement above and satisfies no statute anywhere. **That limit is written down rather than left to be discovered**, and it is the reason the block is signed: what a merchant disclosed is provable afterwards, which is what a regulator and a household both need.

6. **The procedure a person applies through is the presenter's, and a hub renders it.** An implementation MUST NOT let a hub vary what it renders: the block as its merchant signed it, the quantity and the unit price as the offer froze them, the expiry, and the carriage from the delivery record, in the order they were composed. **A hub chooses where things sit on a screen and nothing else** (§10a.5), and this names the consequence rather than adding a rule: what the household applies through is defined by the presenter, which composes the offer, and rendered by whatever hub the person happens to use.

   **Why it is written down, and it is not a technical requirement.** 特商法12条の6 attaches its duty to 「販売業者若しくは……それらの**委託を受けた者**が……映像面に表示する**手続**に従つて」 a customer's application, and a presenter composing offers for a merchant is that merchant's contractor without argument. 消費者庁's clause-by-clause commentary defines 電子契約 as 「販売業者等（**これらの者の委託を受けた者を含む**。）が顧客のコンピューター等の画面上に申込みを行うための**手続を表示させ**」, the seller or its contractor **causing** the procedure to be displayed, and 別添9 makes the screen test functional, 「表題の有無や内容、形式にかかわらず」, with its footnote 2 reaching chat and SNS, so the article plainly does not turn on whose software draws the pixels.

   **So a fork's surface is not an escape and was never meant to be one.** Question 38 of the concept documents asked whether a hub the merchant never appointed displays such a screen at all, and the answer this specification builds on is that the question does not reach the design: the procedure is the presenter's wherever it is rendered, and the duty stays on the merchant where the article puts it. **What remains genuinely unsettled is narrower**, whether a merchant that merely publishes a signed block has entrusted anything to anybody, and this design never relies on that: it rests on the presenter, which is entrusted by composing the offer. 法12条の3 and 12条の4 are the reason to think the narrower reading is right, because where that Act wants a contractor to carry a duty in its own name it creates a named category and demands 「一括して委託」.

   **Presentation is where refusing costs least**, and this section refused only at the decision when it was written, on the reasoning that refusing earlier would let one merchant's omission stop a presenter offering anything at all. **That is backwards.** Refusing at creation costs the presenter one candidate. Refusing at the decision costs a household the whole signed set, because a decided set is all-or-nothing (§10.5), and the person has already read it, decided and signed. **The check at the decision stays** because an offer imported under §14.2 never passed through the receiving host's presentation, and it is the only thing between a block signed by a key that host never held and a household's signature.

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

A candidate MUST NOT appear in both the returned and the consumed list of one collection, **a collection MUST name only candidates of the offer it is recorded against**, with `422 unknown_candidate` otherwise, and a collection MUST NOT be recorded twice for one offer. The middle rule was added on 2026-09-12: an id belonging to no candidate resolved nothing, and the offer still read as collected with goods used, so §6.5's block held over that household with no line for it to sign.

**A cooling window takes back what the person signed, and nothing else.** A physical offer reaches `decided` when the collection resolves its last candidate, so `DELETE /offers/{id}/decisions` (§16.5) MUST leave every candidate the collection named exactly as the collection left it. An implementation that reset them made `consumed` into `offered`, whereupon the household signed `returned` over goods it had used and settled at nothing, on a receipt saying they came back unopened. The rule above would have been true of one route and false of the system.

**What the collection's record may do on its own is nothing.** Added 2026-09-12 with §6.5. A consumed line is charged only on the household's signature over the settlement statement, a disputed line leaves the rail, and the next box is not presented while a statement stands unsigned. The household still cannot name the verdict; it confirms the collection's, or disputes a line of it. The rule above and §6.5 are two halves of one thing: the collection says what happened to the goods, and the household says what it will pay for.

### 11.1 Eligibility

A product is eligible for the physical binding when it is ambient, keeps for at least three times the offer period, is small enough that ten fit in one container, and carries enough margin to absorb recovery and redistribution. Chilled and bulky goods are out of scope for this binding. Regulated categories, including alcohol and medicines, are out of scope entirely.

**Eligibility is recorded on the presenter's catalogue and checked when the offer is created**, not when the goods are loaded. The presenter is the party that knows whether a product is ambient and how long it keeps, and creation is the last moment at which refusing costs nothing.

The digital binding has no eligibility restriction.

----

## 12. Ceremonial offers

The purpose `ceremonial` covers the return gift: the offer sent to many recipients after a wedding, a birth, or a funeral, where the giver has chosen a price band and each recipient chooses one item.

A ceremonial offer names a `giver` beside its `price_band`, and the giver is the payer: the reserve is held against the giver and the settlement's `payer` names them. The `household` on the offer is the recipient, who chooses. An implementation MUST refuse a ceremonial offer that names no giver, and MUST refuse `giver` or `price_band` on any other purpose. Before 2026-09-09 the engine reserved and committed against the household on the offer, which billed the recipient of a return gift for the gift.

**A ceremonial offer is digital.** An implementation MUST refuse `purpose: ceremonial` with `binding: physical`, with `422 ceremonial_is_digital`. Added 2026-09-12, after a refutation pass found that the combination breaks §6.5's premise: clause 25 makes the giver the party charged and §6.5 makes the household's signature over the settlement statement the application for a consumed line, so a physical ceremonial box charges a party that took no act at settlement while the party that acted pays nothing. The same offer also reports what settled against the recipient's daily ceiling (§16.3) while the giver pays.

**Handing the statement to the giver instead is shut, and not by preference.** It lists what the recipient used, which is the candidates clause 24 keeps from the giver and the signal clause 16 and §7.2 forbid returning to them. **So the refusal is the answer available**, and it is one line that opens again.

**The shape that would work is recorded rather than built**, because nothing asks for the combination today. A giver who chose a band made an authorisation in advance, bounded by that band, which is the thing §6.5 exists because nobody had made; a consumed line could settle as a kept line inside it, with no statement and no second signature. An implementation wanting the physical return gift is asking for that design and not for this refusal to be lifted.

| requirement | clause |
|---|---|
| The recipient chooses; the giver does not see the candidates | 24 |
| The offer carries the band the giver chose, shown to the recipient on the approval surface as well as the offer, and no candidate lies outside it. The band bounds the **line**, `unit_price × quantity`, not the unit: five units of something inside the band is five times the band. A candidate outside it is refused with `422 outside_band`, and a ceremonial offer without a band with `400` | 23 |
| If nothing is chosen before expiry, one candidate is `defaulted` and shipped. "Nothing chosen" is the whole condition: a recipient who kept one item and left the rest has chosen, and no default ships beside a kept candidate | 25 |
| Nothing is earned from an unredeemed offer | 25 |
| Cards, wrapping and denominational wording match local convention exactly | none. This was **old clause 29** until 2026-09-09, when the review withdrew it as a requirement standing in a list of prohibitions. It is this specification's, and no clause backs it |

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
13. enforces the person's thresholds where each is enforced, and names the one that refused (§16.3 to §16.6), applies no cooling window to a settlement whose application is the household's signature over a statement, and refuses to withdraw a set that reached its state through a collection rather than through a signature (§16.5)
14. answers only for the surface it presents, and refuses the other with `not_this_role` (§13.1)
15. carries each merchant's own disclosure on the offer and on the approval surface, unaltered, **carries beside it each candidate's quantity and unit price, the offer's expiry, and the carriage from the delivery record where one exists**, carries each candidate's valence so that a line already resolved is not put to the household again (§10 step 3c), carries a product's block only where that product is and never in the standing text's place, and refuses a decision without a disclosure (§10a). **This condition binds the engine's role, and the surface a person signs from is the hub's**: a hub-only implementation is asked nothing here, which is a gap in §13.1's split rather than in this condition
16. charges a physical box's consumed lines only on the household's signature over the settlement statement, **with the carriage inside the bytes that signature covers**, leaves a disputed line off the charge, refuses to settle such a box with no delivery recorded, refuses a signature over a box that has already settled rather than answering it with the settlement that stands, and presents no further physical box **from that presenter** to a household while a statement stands unsigned (§6.5)
17. refuses a ceremonial offer in the physical binding (§12), renders on both the approval and the statement the carriage the hub holds, asking the hub for it where it does not hold the register itself (§13.1, §7.5b), and refuses a delivery update that changes a recorded carriage

Conditions 16 and 17 were added on 2026-09-12: 16 with §6.5, the evening the reference was found to charge consumed lines on the collection's record alone, and 17 with the two defects two independent passes found beside it the same night. Conditions 9 to 11 were added on 2026-09-09, after an adversarial pass measured each of them open in the reference engine. Condition 12 was added on 2026-09-10 with §16, and 13 and 14 on 2026-09-11 with the thresholds and the roles. **Every condition on this list is one a suite asks about**, which is what keeps it from becoming a description of intent. **Condition 15 was added on 2026-09-12**, when three questions about where this system stands between a household and a merchant resolved into one answer: the seller composes what the seller must say, and the person's agent renders it.

### 13.1 Two roles, and what each is judged on

Added 2026-09-10. **An implementation may present the engine's surface, the hub's surface, or both**, and it is judged on the surface it presents.

| Role | Surface (§9) | Whose |
|---|---|---|
| **engine** | `/offers` and its actions except `delivery`, `/candidates/{id}/note`, `/presenters/{id}/export`, the presenter's own registration routes | the presenter's |
| **hub** | `/households/{id}` and its actions, `/_node/mandates`, `/_node/recoverers`, `/lineage/*`, and `delivery` on an offer | the person's |
| both | the registry (§17) is answered by whichever role a deployment puts it behind | neither's |

**One action lives under an offer's path and belongs to the hub.** `GET` and `POST /offers/{id}/delivery` are the household's surface by §7.5b: a carrier's code resolves to an address, so a merchant must not read one, and a hub holds deliveries without holding offers.

**`decisions` was here too until 2026-09-11, and the reason it left is worth keeping.** It was assigned to the hub because a decided set is the person's. It is, and clause 35 makes it so **by the signature**, which whoever answers the route cannot forge. What answering the route needs is the offer, and a hub does not have one: a hub presenting its role alone answered `decisions` and could only ever reply that it had never heard of the offer. **Authority travels in the signature, not in the route.** The correction came from running the two roles apart rather than from reading the design, which is the argument for §13.1 being something a probe can reach.

**An engine is told the name a member's device signs for**, which is the hub's own and not the engine's, because an engine verifies a decided set (§10.5) and cannot check an assertion without it. On a deployment presenting both roles it is the one name the process has. On a split one it is a value the operator gives the engine, and it is the third thing on this interface beside the mandate and the day's total. §14b lists it.

**An engine that does not hold the delivery asks the hub for it over `GET /offers/{id}/delivery`**, which this table already puts on the hub. Added 2026-09-12, and it is the fourth thing on this interface. The register is the hub's because a carrier's code resolves to an address (§7.5b, clause 49), and **the two screens that render the carriage are answered under an offer's path, which is the engine's**: the approval (§10a.5) and the settlement statement (§6.5). Until the engine asked, a split deployment rendered `carriage: null` on both while the hub held a delivery, and a screen with no carriage is either a merchant whose price includes it (法11条1号's own parenthesis) or an implementation that never looked. **A hub that cannot be reached is not a hub holding no delivery**, and an engine MUST refuse rather than render null: reading a transport failure as an absent record takes a statutory item off the screen the moment the network goes, which is the same direction the mandate rule refuses.

**An engine that does not hold the mandate asks the hub for it over these endpoints and not by reading its store.** What it asks for is a protection rather than data about a person: the ceilings, the co-signers needed for a loosening, the lapse and the length of the cooling window. Clause 52 makes the host replaceable and blind, and a boundary that a conformance probe cannot see is a boundary the specification cannot hold anyone to, which is the reason this is stated here rather than left to an implementation.

**A deployment that runs both roles in one process is conformant**, and it is what the reference does. What it may not do is answer for a surface it does not implement.

### 13.2 The state a hub holds, and how it gets it

Dividing routes is not dividing state, and for a day the reference did the first without the second: a hub presenting its role alone answered for the person's surface with nothing behind it. **An implementation MUST NOT present the hub role while answering the person's surface out of a presenter's store.**

The person's side holds three things, and two of them arrive from the engine.

| What the hub holds | How it gets it | Why it is the person's |
|---|---|---|
| the delivery register | written on the hub's own route (§7.5b) | a carrier's code resolves to an address, and no merchant may read one |
| the person's copy of an offer, **including what they declined** | `POST /households/{id}/offers`, sent by the engine when the set is decided | clause 8. What was declined is recorded in the person's node, across every merchant, and no merchant holds that |
| what settled for the person, as an amount and a date | `POST /households/{id}/settled`, sent by the engine as it settles | §16.3's sum is the household's union, and an engine computing it is a merchant computing a person's union, which clause 8 forbids absolutely (no party but the person holds the union) and clause 9 forbids the platform from inferring; clause 38, which this cell cited until 2026-09-11, is a consent rule and would read as though permission could unlock it |

**The copy of an offer is reported when the set is decided, not when it settles.** A copy that arrived only when something was bought would hold the purchases and lose the refusals, which is the half the person's record exists for.

**What settled carries an amount, a date and the offer it belongs to, and nothing about what was in it.** A copy that carried products and merchants would be a second vertical ledger on the person's side rather than the person's own.

**An engine MUST refuse rather than proceed when the hub cannot be reached**, whether it is asking for a mandate, asking for the day's total, or reporting either of the two above. Reading a transport failure as an absent mandate, an empty day, or a report that can be dropped would each fail open: the protections would disappear exactly when the network did.

**What a party keeps is its own.** Nothing in this specification says how, and it says one thing about whether: **an implementation that loses what it holds when it restarts is not conformant for the routes that promise a record.** Clause 43 asks that a person's data be held in a form they can export at any time, and "at any time" is a claim about the day after the process stopped. The reference keeps its rows on disk when a deployment says where and in memory when it does not, and the second is a thing to run tests against rather than a thing to run.

**Keys are neither role's.** `/_identities` registers the public key of a presenter, a household or a recipient, and both roles verify signatures, so both hold them. **It was `/_presenter/identities` until 2026-09-11**, where the name said a presenter's key and the contents were everyone's, a person's included; the route moved rather than gaining an alias, because a name that lies is a thing to fix and not to keep working. Clause 2 puts the root of identity outside this system, which is why this is not a copy one party lends the other. The endpoint registry (§17) is the same and for the same reason (clause 1).

**A route this deployment does not present MUST be refused with `404` and the reason `not_this_role`.** The status is a 404 because from the caller's side the route is not on this party. The name is required because the status alone says two different things: an implementation answers 404 for a household it has never heard of, and the same 404 for a surface it does not present. **A caller that cannot tell them apart retries against the party that will never answer**, and a conformance probe cannot tell an empty implementation from an absent role. This is §16.6's discipline in another place: a refusal names itself.

**An engine that does not hold the mandate asks the hub for it over `GET /_node/mandates/{id}`**, and MUST NOT treat a hub it could not reach as a hub that holds no mandate. An unknown mandate is left alone (§16.2), and reading a transport failure as an unknown mandate would drop every protection the moment the network did.

Tests are in the [Ataraxia](https://github.com/atarasy/ataraxia) repository. Passing them is what entitles an implementation to the mark.

----

## 14. Moving a node

A household moves its node by exporting it from one host and importing it at another (clauses 43, 52). The export carries the household's offers, settlements, notes, receipts and the lineage edges it is an endpoint of.

**It also carries what the route found in each physical box**, as `collections`, one row per offer that has one: what came back, what was used, and when. The format's version is `valence-node/4` since 2026-09-12, because a host that does not know the field would drop it and the member would arrive apparently intact. **The field exists because a refutation pass asked what a move does to §6.5's block**, and the answer was that it lifted: the offers moved with their `consumed` valences, the rows saying a collection had happened did not, and the receiving host presented the next box freely while the sending host held a block over a household that had left. **The merchant's export carried those rows all along** (§14.1), so the shop kept what the person lost, which is the direction clause 43 exists against. **An import MUST NOT replace a row the receiving host already holds**, for §14.2's reason: an import adds what the host does not have, and a host that overwrote its own record of a collection would let whoever composed the export decide what a box came back with.

**Two fields are one word apart and mean different things.** `recoveries` is clause 53's account-recovery log, which says who recovered a locked-out node and when. `collections` is §11's record of a physical box coming back. The first was in the export before the second and the names are kept as they are, because renaming a field in a moved format costs more than a sentence here.

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
- **An offer this host already holds is never changed.** An import adds what the host does not have, and a move lands on a host that has none of it, so nothing about a move is touched by this. What it refuses is the other thing the route can do. **Measured 2026-09-11**: a node handed to a host said an offer was `decided` and every candidate `kept`, with no signature anywhere in it; an offer sitting at `presented` became that, and settling it charged for goods nobody had agreed to. Clause 35 makes a confirmation the person's signature and §10.5 refuses a decided set without one, and this route walked past both. It was the settled case alone before, which §2.1 already required.

An implementation MUST refuse the whole import with `422` when any of these fails, `409` for an offer it already holds, and MUST refuse an export whose `format` it does not recognise with `400`. Added on 2026-09-09: the reference engine's import verified none of it, and an adversarial pass planted a forged edge that made a product unofferable to a household that had never seen it.

**What an import does not do is verify a decision, and it cannot.** A confirmation is a signature over the canonical bytes or an assertion whose challenge is their hash (§10.5), and an assertion names the host it was made for, so a host cannot check one made at another: the check would have to accept any name, which is worth nothing, or rest on a list of legitimate hub names, which is an authority this specification does not have. **So a move is a claim by the sending host rather than a proof**, and clause 52's promise is that a person can leave with what they hold, not that a receiving host can prove how it came about. Deciding this on 2026-09-11 is what left the rule above as the whole of the answer: who may call this route is the host's business (§13.2), and the reference authenticates nobody, which is why the route was reachable by anyone at all.

----

## 14b. Deployment parameters

Added 2026-09-10, because there was no list. Seven values are the deployment's rather than this specification's, and until they were gathered a reader could not count them or tell which had a default. **A parameter with no recommended figure is a deliberate absence**: a number written here once becomes a standard by being quoted, and the ones below are properties of an operation rather than of the protocol.

| Parameter | Where | Default | Why the specification names no figure |
|---|---|---|---|
| exploration rate | §5 | **none. An implementation without one MUST refuse to start** | A rate is a judgement about how much of an offer is given to what the household has not seen. Written here, it stops being the deployment's judgement |
| recovery grace | §11 | **none, as above** | The days after a recovery deadline before goods are `lost` depend on the route and the goods |
| reminder limit | §10.4 | 1, and configurable **downward only** | Clause 33 caps it at one. A deployment may send none |
| the registry's reach | §16.2 | every merchant is in the network | Which merchants the registry lists is what "in the network" means. A deployment without a registry binds the ceiling to nothing, which is the honest reading rather than a silent one |
| the day boundary | §16.3 | **UTC midnight, declared rather than assumed** | A household's day needs a time zone. Choosing one here would make when a person's day starts this specification's business. A deployment MUST apply the same boundary to every household it holds |
| the bindings run | §2 | both | A deployment may run the digital binding alone, and §11's probes then have nothing to reach |
| the relying party | §10.5 | **none. An implementation without one MUST refuse to start** | The name a member's device signs for is the hub's own hostname, a fact about where a deployment is served rather than a figure this specification could supply. Without it an engine cannot tell whom an assertion was made for, and §10.5 requires it to accept assertions, so there is no conforming deployment that does not need one. Added 2026-09-11 |

**Three of the seven have no default at all**, and that is the pattern worth seeing: where the value is a judgement about a person's experience, or a fact only the deployment knows, the specification refuses to supply one and an implementation that starts without it is not conformant. Where the value is a limit the constitution already fixes, or something a deployment can be assumed to do, a default is safe. **The count is of the rows that say none**, and it read "three of the six" until 2026-09-11 while the table held two such rows and a third that has a default and stops no start. Count the rows before quoting the sentence.

----

## 15. Open

- Binding an AP2 mandate to direct-debit rails. The specification is written for card authorisation; no equivalent exists for account transfer, and one is needed.
- Multi-hop lineage attribution, where a product passes through several households before a purchase. The settlement side is out of scope here.
- Whether the feed extension should be proposed to the ACP community or remain a private extension.
- Default values for the exploration rate, the recovery deadline and the loss threshold. All are currently deployment parameters with no recommended figure, and §14b now lists every parameter of that kind in one place, with which of them have a default and why.
- **Whether a conforming implementation owes an authenticated read.** The engine authenticates nobody, so a party that obtains an offer id reads everything under it, and §7.2's promise about what a giver may see holds in the shape of every response and not against a determined asker. Deferred 2026-09-13 rather than decided against: it reaches every route here, and it is what proving clause 53 of the constitution needs, so the moment to do it is when a host is first certified. Opened 2026-09-12 as question 41 of the concept documents.
- **Whether a confirmation should be bound to a moment.** The canonical form of §10.5 names an offer and a set and nothing else, which is what let a withdrawn set be put back by resending the bytes. That is closed by refusing a confirmation twice, and the closure is narrower than the problem: it is the implementation remembering rather than the signature saying. A nonce issued with the offer, or the offer's own version, inside the signed bytes would say it. Both change what every implementation signs, so neither is decided here. Opened 2026-09-11.
- **How a hub learns that an offer was presented.** §13.2 sends the person's side a copy when a set is decided, and nothing at all when it is presented, so a hub has no way to know that its member has something waiting except to ask each presenter it knows for that household's offers (§9). That is what the reference hub does. It works because the registry names the presenters; it does not work for a presenter the person has never dealt with. Opened 2026-09-11.

----

## 16. Mandates

A mandate is the person's standing protections, and clauses 46, 47 and 58 are about what may change in it and who has to sign. Until 2026-09-09 it was a reference an offer carried, so all three were promises.

```
mandate
  id
  household
  ceiling_out_of_network   what one offer may cost at merchants the registry does not list (clause 46)
  ceiling_daily            what may settle for this household in one day, across every presenter
  cooling_seconds          how long a decided set waits before it settles
  co_signers[]             keys named while the person had capacity (clause 47)
  lapses_at                a standing mandate lapses unless renewed (clause 58)
  version                  1 for a new mandate, then one more each time
```

`ceiling_daily` and `cooling_seconds` are absent when the person has not set
them, and absent is not zero: no daily ceiling and no cooling, against a
`ceiling_daily` of 0 that would refuse everything.

**Three fields were added on 2026-09-10 and one of them left on 2026-09-12.**
`co_sign_categories` named the feed categories whose candidates needed a
co-signer's signature on the decided set, and §16.4 was the rule that read it.
It is removed rather than deprecated: a field nobody reads that everybody signs
is residue, and the signed form is seven lines rather than eight. **The
co-signers stay and so does clause 47**; what went is the per-purchase half.
Nothing stored breaks, because a signature is checked when its version is
submitted and is not retained (§16.1).

### 16.1 Who signs a change

Every version is signed by the household over the canonical form: the fields above, one per line, in the order listed, with `co_signers` sorted, **each item percent-encoded**, and joined by commas, an absent `ceiling_daily` or `cooling_seconds` as an empty line, and the version inside the bytes so that an old signature cannot be replayed onto a new record. This sentence named no escaping until 2026-09-11, and the escaping is why the next paragraph but three exists.

A change **loosens** when it raises either ceiling, pushes `lapses_at` further out, drops a co-signer, or shortens `cooling_seconds`. A loosening MUST also carry the signature of every co-signer the **previous** version named. A tightening is the person's alone: lowering a ceiling and lengthening cooling are both tightenings.

**Signatures are verified at submission and MUST NOT be retained.** What a signature covers is the canonical form as it stood when the signature was made, and an implementation that keeps signatures in order to re-check them later has taken on a compatibility problem that this one does not have. An implementation MUST refuse with `422` a version that is unsigned, signed by the wrong key, or missing a co-signer's signature on a loosening, and MUST refuse a version that is not exactly one more than the last.

**A person signs, or their passkey asserts.** A key named here sends either the signature over those bytes or an assertion whose challenge is their SHA-256, in the shape §10.5 defines, and an implementation MUST accept both and MUST refuse a key that sends both at once. **The second shape is not a convenience.** An authenticator signs its own data and the hash of the client's, never bytes a caller hands it, so a person who holds a passkey and nothing else cannot produce the first, and until 2026-09-11 this section asked for the first alone: such a person could record no ceiling, no cooling window and no co-signer, and §16.5 went with it, because there is nothing to take a decided set back into. It was found by building the screen where a member sets their protections, which is how the same defect in §10.5 was found the same morning.

**The rule is "wherever a person's signature is checked once and then forgotten", which is not the same as "wherever a person signs".** §16.4's co-signature was the other place it applied, and took the same change on the same day after a review found that a family whose co-signer held a passkey could name a category needing a second signature and then have no way at all to give one; §16.4 itself was removed on 2026-09-12 and the rule outlived it. **§7.1's lineage edge is the one that stays**, and the reason is the one that settles §14.2's import question too: an edge is verified again every time it is imported, and an assertion names the host it was made for, so an edge signed by one could be re-verified nowhere but where it was made. A gift is therefore out of reach from a hub until §7.1 stops re-verifying, and that is written here rather than left to be discovered.

**Each item of the co-signer list is percent-encoded before the comma joins them.** A plain join is malleable: `["a","b"]` and `["a,b"]` are the same bytes, so whoever relays a change can fuse two co-signers into a name nobody holds, after which no loosening could ever be signed, and the signature still verifies. Measured 2026-09-11 by an adversarial pass, on the category list that left with §16.4 the following day. §7.1's edge form already escapes, for this reason.

This is what clause 47 means by "nothing else changes it": not the person alone, not a co-signer alone, and no layer, which holds no key at all.

**Two things about the cooling window are true and neither is obvious** (§16.5). It is read when a set is taken back or settled and not when it was signed, so a person who sets a window afterwards may take back a set that was final when they signed it, and a presenter entitled to settle at once is deferred for the length of a window the person added later. That direction is the person's to gain, and the other is not: shortening needs the co-signers. And **taking a set back asks for no signature at all**, so whoever holds the offer id can do it, the presenter included, and a presenter refused a withdrawal under a decided offer can reach `presented` this way and withdraw from there. Both were measured on 2026-09-11 and both are named here rather than fixed, because binding a withdrawal to the person needs something the canonical form does not have, a nonce, which §15 already carries as an open question.

### 16.2 The ceiling

At presentation, an implementation that holds a mandate for the offer MUST refuse with `422` when what the offer could cost at merchants the registry does not list exceeds `ceiling_out_of_network`, and MUST refuse when the mandate has lapsed. The registry is what "in the network" means (§17); a person's limit on the rest is applied inside their own mandate, which is clause 46's ceiling under clause 47's structure. **This line cited clause 55 until 2026-09-11**, and clause 55's exclusion is of a fork of the hub's software, not of a merchant the registry does not list.

An offer whose mandate this implementation does not hold is left alone. A deployment may carry mandates elsewhere, and refusing every offer whose mandate is unknown would be a gate rather than a protection.

### 16.3 The daily ceiling

At settlement, an implementation that holds a mandate for the offer MUST refuse with `422` when what has already settled for this household today, plus what this settlement would charge, exceeds `ceiling_daily`.

**The day is the deployment's, not this specification's.** A household's day needs a time zone, and a specification that named one would be deciding when a person's day starts. A deployment declares the boundary and MUST apply the same one to every household it holds.

**The sum is the household's own union.** It crosses presenters, so it is read by the person's own agent and by no merchant (clauses 8 and 9; clause 38 makes the agent the default recipient, and it is 8 and 9 that make the union nobody else's). A presenter learns only that this settlement was refused, which is what it learns when a household declines.

**A ceiling refuses, and a household can be left with a box it cannot settle at all.** Question 39, decided 2026-09-13, and the answer is that the refusal stands and the screen says so. Since §6.5 the party pressing the button is the household, so this refusal lands on the person rather than on a presenter's retry, and where a box's own consumed total is above the ceiling it can never be signed at that ceiling on any day: the sum does not change, and the cure is to raise the ceiling, which is a loosening. **What a loosening needs depends on whom the mandate names**, and this sentence said it needs "the people the person named" as though there always were some: §16.1 requires every co-signer the previous version named, so a mandate naming none is loosened by the person alone, and clause 47 was amended on 2026-09-13 to say so. Measured the same day: a household with no co-signers raised its daily ceiling and then removed it, signing alone, and the engine accepted both. **So a household that named nobody is never permanently stuck**, and one that named somebody is stuck until they sign. The first version of this paragraph, written 2026-09-13, had it the other way round for every household. **The two alternatives were both worse.** Exempting a statement settlement gives up the one protection that spans presenters at exactly the moment money moves. Letting the box settle across days needs a partial settlement this specification does not have, and a partial settlement of a document the household signed whole is a different signature. So a surface MUST say, where it offers a daily ceiling, that a ceiling can stop a box settling until it is raised, and MUST NOT tell a household that naming nobody leaves it no way to raise one; **a screen that renders this refusal as a wait is telling the household to come back tomorrow for something that may never become possible.**

**The sum is kept by the hub.** Section 13.2 defines the household's settlement copy and the interface through which engines report settlements and ask for the day's total. The reference implements this with its household ledger and local or remote day source. The previous version of this paragraph described the earlier engine-local sum and said neither interface was built, contradicting §13.2 and the implementation.

An engine counts the household's total reported to that hub, rather than only its own settlements. This does not establish an atomic reservation across concurrent engines: reading a total and reporting a settlement are separate operations. Nor does the reference authenticate access to these routes; the deferred authentication boundary is described in §7.2. Neither limitation is removed by locating the ledger on the correct side.

### 16.4 Withdrawn on 2026-09-12

This section required a co-signer's signature on any decided set holding a
candidate whose `category` the person had named, and `co_sign_categories`
carried the list. **The number is kept so that citations of §16.5 and §16.6 do
not move**, exactly as the constitution kept clause 50's.

**Three reasons, in the order they weigh.** Nobody asked for it: stopping a
purchase by its kind rather than by its price was not requested by a customer,
a member, or any candidate in the market study. The ceilings cover the same
ground by amount, and **a ceiling is the protection a presenter cannot
relabel**, because it is arithmetic on a price rather than a judgement about a
word, which this section itself said. And the mechanism carried a defect nobody
noticed until the screen was built: a category set while no co-signer was named
locked the household out of it permanently, because a signature was required
from `co_signers` and there was nobody to give one.

**What it cost is worth recording.** The protection this section did offer was
against a presenter that is careless rather than one set on avoiding it: the
category is inside the catalogue's signed bytes, so a relaying party cannot
strip one, while the presenter itself may publish a version that omits it. If
stopping a purchase by kind is ever wanted again, it is built from nothing, and
the second build starts without the probes and the mutations this one had.

### 16.5 Cooling

A decided set under a mandate with `cooling_seconds` set does not settle when it is signed. `POST /offers/{id}/settle` MUST refuse with `422 mandate_cooling` until `cooling_seconds` have passed since the decision, and `DELETE /offers/{id}/decisions` withdraws the set before then, returning the offer to `presented`. Withdrawing is the person's alone and needs no co-signer. **The refusals of this section name themselves too**, as §16.6 requires of its own: `422 no_cooling` where the mandate sets no window, `422 cooling_over` once it has closed, and `409 not_withdrawable` where the state came from a collection rather than from a signed set. **They were unnamed here until 2026-09-13**, and a name the specification does not carry is one no probe has to assert and no second implementation has to produce: `cooling_over` lost its only assertion that day when the probe holding it was rewritten, and nothing could say so.

**Cooling does not make silence into consent** (clause 32). It applies only after the person has confirmed: the set is signed, and the window is time in which a signed decision can be taken back. An unconfirmed offer is still no order.

**A window belongs to a set the household signed, and to nothing else.** Question 42, decided 2026-09-13. §6.5 made a household's signature over the settlement statement the application for a physical box's consumed lines, and §11 has a collection move an offer out of `presented` once every line is resolved, stamping the moment the window runs from with the collection's time. The two together put a box the household never answered inside a cooling window: the household's signature over its statement was refused for the whole window, the signature was discarded, and §6.5's block on that presenter's next box stood meanwhile. **A member who set a day lost a day of deliveries after every swap with anything used, and the window protected a decision nobody had made.** So an implementation MUST NOT apply `cooling_seconds` to a settlement whose application is the household's signature over a statement (§6.5). The window keeps its whole meaning where it has one: a decided set in the digital binding, and a physical box the household answered itself.

**The alternative considered and refused** was to run the window from the household's signature instead of from the collection, which makes it a delay on the charge rather than a bar on the application. It needs somewhere to hold a signed statement that has not settled, which is a new state and a new surface, and it buys the household a period in which it may take back an application it has just made deliberately. The point of a cooling window is to undo a decision taken quickly; a statement is signed against a document listing what was used.

**A set that reached `decided` through a collection cannot be taken back.** Question 43, decided 2026-09-13. `DELETE /offers/{id}/decisions` MUST refuse, with `409`, an offer whose state came from a collection rather than from a signed set, which an implementation can tell because no confirmation was recorded for it. Withdrawing is the removal of a commitment, which is why this route needs no signature; **where the household signed nothing there is no commitment to remove**, and the route did three things instead. The box returned to `presented` with the collection's verdicts intact, so it reached no section of the household's own list and was invisible until it expired. The household's signature over the original statement was then refused as out of state. And §6.5's block lifted, because the block counts only boxes in `decided` and `expired`, so the presenter's next box presented at once; a presenter that then withdrew the box left the consumed goods charged to nobody. The route needs no signature by design and a presenter knows its own offer ids, so this was reachable by the party it costs the household most. Found by a refutation pass on 2026-09-12.

**Why seconds and not a clock.** An order placed at night that runs the next morning is a cooling window expressed in seconds; expressed as a rule about clocks it would need a time zone, and the household's day would become this specification's business. §16.3 needs the boundary and says so, which is the difference between the two.

### 16.6 A refusal names the threshold that refused it

Refusals in this section share a status code, and a person MUST be able to tell them apart. The body carries an `error` of

```
mandate_ceiling_out_of_network | mandate_ceiling_daily |
mandate_cooling | mandate_lapsed
```

There were five until 2026-09-12, when §16.4 was withdrawn and
`mandate_co_sign_required` went with it.

**This is the lesson of `novelty_from_this_catalogue`**, a mutation that survived every probe because two different refusals shared a status code and nothing else. A `422` with no name is a refusal no probe can tell from another `422`, and clause 36 requires that the reason an order was not executed be shown to the person.

These name refusals of a request. They are not the deliberation reasons of §10, which name why a candidate was left out of an offer, and `outside_mandate` stays the reason there.

**The discipline is not this section's alone, decided 2026-09-13 as question 45.** Every refusal this specification names anywhere carries that name in the `error` of its response, and a conforming implementation is read against the names here rather than against a reference's own vocabulary. **The measurement that prompted it**: of the four names above, one appeared in neither the reference nor the suites while the reference threw `over_ceiling` instead, one was asserted by nothing, and a conformance probe pinned the wrong word, so the suites were certifying a departure from this section. Five further names the specification used were asserted by no probe, and two the suites required appeared in no section, which means **an implementation built from this document alone would have failed those probes while conforming to every word**, the opposite of what a conformance suite is for.

**A status-only probe does not check the refusal name.** A mutation that changes the word is caught only where a probe asserts that word. Comparing the specification's defined names with actual response assertions is therefore a separate check. `scripts/refusals.py` is an aid to that review, but its substring and quoted-string searches can mistake prose, comments and request values for definitions or assertions; a reported match is not proof of either.

----

## 17. The endpoint registry

Added 2026-09-09. A merchant that speaks Valence has to be findable by a household's agent, and clause 1 forbids the infrastructure from being the place where things are found. Those two hold together only if the registry **resolves and does not rank**.

### 17.1 What it is

A shared, neutral directory of merchant endpoints. It answers one question: given a merchant's key, or a protocol, which endpoints exist and where. It is the routing layer clause 1 asks for, one that resolves and does not rank, made concrete. This sentence cited clause 2 until 2026-09-09; routing moved to clause 1 in the review and the citation did not follow, so it named the identity clause as authority for a directory.

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

## Appendix A. Experimental contextual member statements

This opt-in internal deployment profile leaves §6.5 and §10.5 legacy canonical signatures unchanged. It adds no HTTP request field and no §13 conformance claim. Its identifier is `atarasy.member-statement-authorisation.1`.

The envelope contains `profile`, `environment`, `origin`, `rpID`, `id`, `principal`, `credential`, `household`, `keyFingerprint`, `offer`, `mandate`, `presenter`, `canonical`, `reviewedRevision`, `expiresAt` and `requestDigest`. Digests are lowercase SHA-256 hex; key fingerprint hashes the mandate key's SPKI DER. Request digest hashes UTF-8 JSON of `['atarasy.member-operation.1', JSON.stringify([1, environment, origin]), principal, credential, household, keyFingerprint, offer, mandate, presenter, canonical, reviewedRevision, expiresAt]`. The WebAuthn challenge is unpadded base64url SHA-256 of UTF-8 JSON of `[profile, JSON.stringify([1, environment, origin, rpID]), id, requestDigest, reviewedRevision]`.

The engine **MUST** explicitly configure environment and HTTPS origin, match RP, recompute both digests, compare canonical bytes to current lines and carriage, and verify the assertion with the registered mandate key. It **MUST** require the configured origin, `webauthn.get`, user presence and verification, and refuse cross-origin/top-origin assertions and expired envelopes. It **MUST NOT** accept a caller-supplied expected challenge or a verification boolean. A receipt for this profile **MUST** retain exact envelope/assertion identity so a different operation cannot receive success through legacy signature-only replay.

The trusted local adapter **MUST** validate current member authority, credential binding/counter, the complete reviewed snapshot and operation claim under the same database transaction as local ledger, daily report, engine receipt and committed outcome. The engine's cryptographic envelope verification alone does not establish current authority or a fresh review. The adapter **MUST NOT** expose this path until every writer shares that boundary. External ledgers require a separately specified uncertainty/reconciliation boundary. Exact committed read-back may return the stored receipt after operation expiry, under current access authority, without executing settlement again.

## Appendix B. Local engine reconstruction

A persistent deployment **MUST** reconstruct candidate lookup from stored offers when creating a fresh engine. Candidate identifiers **MUST** be unique within and across offers; ambiguous stored state **MUST** be refused, and an import **MUST NOT** introduce ambiguity into existing candidate references.

The bare receipt records of §7.6 contain opaque references and timestamps, not edge identifiers. A persistent deployment **MUST** preserve those exact records independently of lineage edges. Reconstruction **MUST NOT** mint replacement references or derive references from edge identifiers. Receipt imports preserve supplied reference/time records; reading them **MUST NOT** grant mutation of persisted engine state. A legacy store without receipt rows cannot reconstruct lost random references from edges and requires an explicit export or a declared history gap at migration.

Under the unified local boundary, accepting a lineage edge and writing its bare receipt **MUST** commit or roll back together. Ordinary write-through storage alone does not provide that multi-record guarantee. These are internal persistence requirements, not additional §13 external conformance probes.
