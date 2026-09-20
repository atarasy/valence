import pathlib
# §16.1, decided 2026-09-20 after the third refutation pass over question 68.
# A protection recorded below zero, or as a fraction, at every caller that is
# not the HTTP route. A negative window is not an absent one, so §16.5's
# longest selects it wherever it is a household's only one.
p = pathlib.Path("src/hub/mandates.ts"); s = p.read_text()
old = "      if (typeof value !== \"number\" || !Number.isSafeInteger(value) || value < 0) {"
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, "      if (false) {", 1)
p.write_text(s)
