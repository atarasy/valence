import pathlib
# Clause 25: a default ships only if nothing was chosen. Ship one beside a kept item.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
old = "    if (offer.purpose === \"ceremonial\" && undecided.length > 0 && nothingKept) {"
assert old in s
s = s.replace(old, "    if (offer.purpose === \"ceremonial\" && undecided.length > 0) {", 1)
p.write_text(s)
