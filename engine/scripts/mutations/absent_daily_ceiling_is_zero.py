import pathlib

# §16. Absent is not zero. Read a missing daily ceiling as a ceiling of zero
# and every settlement is refused, which is the opposite of what the person
# who set nothing asked for.

p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
a = "    if (mandate?.ceiling_daily != null) {"
assert a in s, "offers.ts daily ceiling anchor has drifted"
s = s.replace(a, "    if (mandate) {", 1)
b = "      if (already + charged > mandate.ceiling_daily) {"
assert b in s, "offers.ts daily comparison anchor has drifted"
s = s.replace(b, "      if (already + charged > (mandate.ceiling_daily ?? 0)) {", 1)
p.write_text(s)
