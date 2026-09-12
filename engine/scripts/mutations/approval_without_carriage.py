import pathlib

# §10a.5, §7.5b. The approval surface never shows carriage, even when the hub
# has recorded a delivery for the offer. Carriage is the one fact of the sale
# the offer does not hold, so a screen that drops it is complete by the offer's
# lights and short by the household's: it is asked to sign a price that the
# parcel will raise.

p = pathlib.Path("src/hub/approval.ts"); s = p.read_text()
a = "      carriage: delivery ? delivery.carriage : null,"
assert a in s, "approval.ts carriage anchor has drifted"
s = s.replace(a, "      carriage: null,", 1)
p.write_text(s)
