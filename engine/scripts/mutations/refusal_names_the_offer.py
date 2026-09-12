import pathlib
# §6.5, clause 8. The refusal names the waiting box, so one presenter learns
# another presenter's offer id and `GET /offers/{id}` serves it: products,
# prices, merchant, and which lines that household used. §16.3 already settles
# the shape a refusal takes, which is that it says only that it refused.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
a = '        "an earlier box for this household was collected with goods used and its settlement statement is not signed"'
assert a in s, "offers.ts refusal message anchor has drifted"
s = s.replace(a, '        `offer ${[...this.offers.values()].find((o) => o.household === offer.household && o.id !== offer.id)?.id} was collected with goods used and its settlement statement is not signed`', 1)
p.write_text(s)
