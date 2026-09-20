import pathlib
# §16.5, decided 2026-09-20 after the third refutation pass over question 68.
# The record does not say which of its values came from an earlier reading,
# so nothing a person or a presenter can read tells a protection that was
# applied from one that was not read at the decision.
p = pathlib.Path("src/engine/offers.ts"); s = p.read_text()
old = "    if (stale.length > 0) fixed.stale = stale;\n"
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, "", 1)
p.write_text(s)
