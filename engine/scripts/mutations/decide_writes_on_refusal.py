import pathlib
# §10.5: nothing is written on refusal. Write each line as it is checked.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
old = "      seen.add(d.candidate);\n"
assert s.count(old) == 1
s = s.replace(old, old + "      candidate.valence = d.valence;\n      candidate.decided_at = now;\n", 1)
p.write_text(s)
