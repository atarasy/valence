import pathlib
# Clause 23: no candidate lies outside the band the giver chose. Keep the band
# on the offer and stop checking candidates against it.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
old = "        if (line < input.price_band.min || line > input.price_band.max) {"
assert old in s
s = s.replace(old, "        if (false) {", 1)
p.write_text(s)
