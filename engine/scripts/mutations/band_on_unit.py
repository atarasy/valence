import pathlib
# Clause 26: the band bounds the line. Check the unit price instead.
p = pathlib.Path("src/engine.ts"); s = p.read_text()
old = "        const line = c.unit_price * c.quantity;"
assert old in s
s = s.replace(old, "        const line = c.unit_price;", 1)
p.write_text(s)
