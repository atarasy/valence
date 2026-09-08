import pathlib
# Clause 6: an exclusion names a published rule. Remove the check, so any
# string is accepted as a reason and the routing rule becomes whatever the
# agent says it was.
p = pathlib.Path("src/http.ts"); s = p.read_text()
old = "          if (!(EXCLUSION_RULES as readonly string[]).includes(reason)) {"
assert old in s
s = s.replace(old, "          if (false) {", 1)
p.write_text(s)
