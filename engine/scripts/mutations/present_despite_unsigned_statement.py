import pathlib

# §6.5, §11.2. The next box comes while the last one's statement stands
# unsigned. Nothing then presses a household to sign, and a merchant that
# keeps delivering accrues a claim the rail cannot collect and the household
# never confirmed.

# Re-anchored twice on 2026-09-12: when the scan was renamed and stopped naming
# the waiting offer, and when its scope narrowed to the presenter's own boxes.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
a = "      this.hasUnsignedStatement(offer.household, offer.presenter, offer.id)"
assert a in s, "offers.ts hasUnsignedStatement anchor has drifted"
s = s.replace(a, "      false", 1)
p.write_text(s)
