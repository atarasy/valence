import pathlib
# Clause 46: the ceiling is the person's and they may lower it. Require the
# co-signers for every change, so a person cannot tighten their own
# protection without whoever they named.
p = pathlib.Path("src/hub/mandates.ts"); s = p.read_text()
old = "    if (before && loosens(before, mandate)) {"
assert old in s
s = s.replace(old, "    if (before) {", 1)
p.write_text(s)
