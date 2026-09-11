import pathlib
# Section 10.5, second break beside decide_writes_on_refusal. The plan is kept
# and each line is applied as it is checked rather than after every line has
# been, so a set whose second line is refused has already changed the first.
# Nothing is written on refusal is the property, and a loop that writes as it
# goes breaks it without removing a single check.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
old = "      plan.push({ candidate, d });"
assert old in s, "decide_writes_as_it_validates: the anchor has drifted"
s = s.replace(old, '      candidate.valence = d.valence;\n      plan.push({ candidate, d });', 1)
p.write_text(s)
