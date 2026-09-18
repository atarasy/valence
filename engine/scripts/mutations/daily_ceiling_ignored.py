import pathlib

# §16.3. Drop the daily sum at settlement, which is the state every version
# before 2026-09-10 shipped: the field did not exist and nothing bound a
# household's day across presenters.

p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
a = "    if (ceilingDaily != null && charged > 0) {"
assert a in s, "offers.ts daily ceiling anchor has drifted"
s = s.replace(a, "    if (false && ceilingDaily != null && charged > 0) {", 1)
p.write_text(s)
