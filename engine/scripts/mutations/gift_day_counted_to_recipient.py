import pathlib
# §12, §16.3, question 60. Count a gift's charge to the recipient's day while
# the giver pays.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '      // Question 60: counted to the day of whoever paid.\n      household: payer,\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '      household: offer.household,\n', 1)
p.write_text(s)
