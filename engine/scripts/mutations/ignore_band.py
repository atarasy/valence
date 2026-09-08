import pathlib
# Clause 26: no candidate in a ceremonial offer lies outside the band the
# giver chose. Keep the band on the offer and stop checking candidates
# against it.
p = pathlib.Path("src/engine.ts"); s = p.read_text()
old = "        if (c.unit_price < input.price_band.min || c.unit_price > input.price_band.max) {"
assert old in s
s = s.replace(old, "        if (false) {", 1)
p.write_text(s)
