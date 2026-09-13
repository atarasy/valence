import pathlib
# Clause 10, §6.2: change the consumed branch, not the identical kept price.
p = pathlib.Path("src/engine/offers.ts")
s = p.read_text()
start = s.index('} else if (c.valence === "consumed") {', s.index('kept += amount;'))
end = s.index('} else if (c.valence === "lost") {', start)
old = "const amount = c.given_by ? 0 : c.unit_price * c.quantity;"
branch = s[start:end]
assert branch.count(old) == 1, "consumed pricing anchor drifted"
branch = branch.replace(old, "const amount = c.given_by ? 0 : Math.floor(c.unit_price * c.quantity * 0.35);", 1)
p.write_text(s[:start] + branch + s[end:])
