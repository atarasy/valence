import pathlib
# §16.1, decided 2026-09-20 after the third refutation pass over question 68.
# The engine reads whatever a source answers. The bound lived in
# `MandateRegister.record` alone, so a hub that is not this register, and a
# row written before the bound existed, fixed a decided set for thirty years.
p = pathlib.Path("src/engine/mandate-source.ts"); s = p.read_text()
old = "  return Math.min(MAX_COOLING_SECONDS, Math.max(0, Math.ceil(value)));"
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, "  return value;", 1)
p.write_text(s)
