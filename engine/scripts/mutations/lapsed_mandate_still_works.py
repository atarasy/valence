import pathlib
# Clause 58: a standing mandate lapses unless renewed. Present on one anyway.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
old = "      this.mandates.mustGet(offer.mandate, now);"
assert old in s
s = s.replace(old, "      void now;", 1)
p.write_text(s)
