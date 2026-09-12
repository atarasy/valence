import pathlib

# §6.2, clause 10. Include a kept gift's price in the settlement calculation;
# a consumed gift remains free. The 2026-09-12 history records a committed
# gift charge before the kept-gift fixture existed. In the completed mutation
# logs from the original 299 sweep, reviewed 2026-09-13, the reserve ceiling
# instead prevents settlement: HTTP returns 422 and both units throw
# settlement_exceeds_reserve. Their receipt assertions are not reached.
# This describes that earlier run, not a measurement of the current candidate.

p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
a = "        const amount = c.given_by ? 0 : c.unit_price * c.quantity;\n        kept += amount;\n        line(c, amount);"
assert a in s, "offers.ts kept-gift anchor has drifted"
s = s.replace(a, "        kept += c.unit_price * c.quantity;\n        line(c, c.unit_price * c.quantity);", 1)
p.write_text(s)
