import pathlib
# §11.2, question 46. A collection may name a line the household kept. Re-anchored
# 2026-09-14 when the rule moved into the engine and began to admit `returned`.
p = pathlib.Path('src/engine/physical.ts'); s = p.read_text()
old = '    if (decided.length > 0) {'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '    if (false) {', 1)
p.write_text(s)
