import pathlib
# Clause 8: a presenter's vertical view holds nothing declined to anyone
# else. Drop the presenter filter, which is what the engine did until
# 2026-09-09, so the list becomes the household's union.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
old = "      (o) => o.household === household && o.presenter === presenter"
assert old in s
s = s.replace(old, "      (o) => o.household === household", 1)
p.write_text(s)
