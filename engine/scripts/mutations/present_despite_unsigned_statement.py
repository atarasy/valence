import pathlib

# §6.5, §11.2. The next box comes while the last one's statement stands
# unsigned. Nothing then presses a household to sign, and a merchant that
# keeps delivering accrues a claim the rail cannot collect and the household
# never confirmed.

# Re-anchored 2026-09-12 (night), when the scan was renamed and stopped naming the waiting offer.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
a = "    if (offer.binding === \"physical\" && this.hasUnsignedStatement(offer.household, offer.id)) {"
assert a in s, "offers.ts hasUnsignedStatement anchor has drifted"
s = s.replace(a, "    if (false) {", 1)
p.write_text(s)
