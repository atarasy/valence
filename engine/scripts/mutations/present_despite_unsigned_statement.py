import pathlib

# §6.5, §11.2. The next box comes while the last one's statement stands
# unsigned. Nothing then presses a household to sign, and a merchant that
# keeps delivering accrues a claim the rail cannot collect and the household
# never confirmed.

p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
a = "      const unsigned = this.unsignedStatementFor(offer.household, offer.id);"
assert a in s, "offers.ts unsignedStatementFor anchor has drifted"
s = s.replace(a, "      const unsigned = null as string | null;", 1)
p.write_text(s)
