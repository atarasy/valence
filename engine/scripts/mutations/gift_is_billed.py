import pathlib
# Clause 10, §6.2: bill a consumed gift, leaving the kept branch unchanged.
p = pathlib.Path("src/engine/offers.ts")
s = p.read_text()
start = s.index('} else if (c.valence === "consumed") {', s.index('kept += amount;'))
end = s.index('} else if (c.valence === "lost") {', start)
old = "const amount = c.given_by ? 0 : c.unit_price * c.quantity;"
branch = s[start:end]
assert branch.count(old) == 1, "consumed pricing anchor drifted"
branch = branch.replace(old, "const amount = c.unit_price * c.quantity;", 1)
p.write_text(s[:start] + branch + s[end:])
