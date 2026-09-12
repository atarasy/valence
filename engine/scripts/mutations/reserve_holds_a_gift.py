import pathlib

# §6.2, clause 10. The reserve taken at presentation holds a gift's price.
# **This is what the engine did until 2026-09-13**, three days after the
# settlement rule it contradicts: nothing was ever charged by it, so it
# outlived every pass that looked at the charge. On an adapter that
# authorises, the household's authorisation covers money that can never be
# taken.

p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
a = "      (sum, c) => sum + (c.given_by ? 0 : c.unit_price * c.quantity),"
assert a in s, "offers.ts upperBound anchor has drifted"
s = s.replace(a, "      (sum, c) => sum + c.unit_price * c.quantity,", 1)
p.write_text(s)
