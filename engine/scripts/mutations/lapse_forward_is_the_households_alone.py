import pathlib
# §16.1, decided 2026-09-19 after the first refutation pass over question 68.
# Count bringing a co-signed mandate's lapse forward as a tightening again, so
# the household does it alone, lets its tight mandate lapse, and a loose
# label it recorded alone governs every offer.
p = pathlib.Path('src/hub/mandates.ts'); s = p.read_text()
old = "  if (before.co_signers.length > 0 && after.lapses_at < before.lapses_at) return true;\n"
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, "", 1)
p.write_text(s)
