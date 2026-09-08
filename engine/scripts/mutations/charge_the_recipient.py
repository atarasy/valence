import pathlib
# Clause 25: the giver pays a ceremonial offer. Bill the household on the offer, the recipient.
p = pathlib.Path("src/engine.ts"); s = p.read_text()
old = "      household: offer.giver ?? offer.household,"
assert old in s
s = s.replace(old, "      household: offer.household,", 1)
old2 = "      payer: offer.giver ?? offer.household,"
assert old2 in s
s = s.replace(old2, "      payer: offer.household,", 1)
p.write_text(s)
