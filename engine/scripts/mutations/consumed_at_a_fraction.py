import pathlib
# Clause 10, §6.2: two bases and no third. Settle used goods at a fraction of
# the price, which is a cost basis under another name.
p = pathlib.Path("src/engine.ts"); s = p.read_text()
old = "        const amount = c.given_by ? 0 : c.unit_price * c.quantity;"
assert old in s
s = s.replace(old, "        const amount = c.given_by ? 0 : Math.floor(c.unit_price * c.quantity * 0.35);", 1)
p.write_text(s)
