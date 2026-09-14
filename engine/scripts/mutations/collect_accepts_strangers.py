import pathlib
# §11.2. A collection names candidate ids that are not the offer's. Nothing is
# resolved, and the offer still reads as collected. Re-anchored 2026-09-14 when
# the check moved from the route into the engine.
p = pathlib.Path('src/engine/physical.ts'); s = p.read_text()
old = '    if (strangers.length > 0) {'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '    if (false) {', 1)
p.write_text(s)
