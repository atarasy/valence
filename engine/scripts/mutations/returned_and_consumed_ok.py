import pathlib
# Since question 46 the collection route checks for two verdicts on one item
# before its completeness rule, and `collect` checks again for direct callers.
# Removing only the second would leave the observable refusal in place, which
# reads as a survivor and is not one, so both are removed.
p = pathlib.Path("src/engine/physical.ts"); s = p.read_text()
old = "    if (both.length > 0) {"
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, "    if (false) {", 1)
p.write_text(s)
h = pathlib.Path("src/http.ts"); t = h.read_text()
route = "        if (repeated.length > 0) {"
assert t.count(route) == 1, "route anchor drifted"
t = t.replace(route, "        if (false) {", 1)
h.write_text(t)
