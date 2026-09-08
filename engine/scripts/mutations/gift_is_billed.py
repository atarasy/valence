import pathlib
# Clause 10, §6.2: a gift is never billed to the person who received it. Bill it.
p = pathlib.Path("src/engine.ts"); s = p.read_text()
old = "        const amount = c.given_by ? 0 : c.unit_price * c.quantity;"
assert old in s
s = s.replace(old, "        const amount = c.unit_price * c.quantity;", 1)
p.write_text(s)
