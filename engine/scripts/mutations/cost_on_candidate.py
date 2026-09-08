import pathlib
# Clause 10: no cost of goods is ever quoted to a person. Put one on every
# candidate in the offer view. Since 2026-09-09 the catalogue has no cost
# field, so this invents one, which is the shape the leak would take.
p = pathlib.Path("src/http.ts"); s = p.read_text()
old = "    given_by: c.given_by,\n    valence: c.valence,"
assert old in s
s = s.replace(old, "    given_by: c.given_by,\n    cost: Math.floor(c.unit_price * 0.35),\n    valence: c.valence,", 1)
p.write_text(s)
