import pathlib
# §11.2. One item carries two verdicts in one collection. Since 2026-09-14 the
# engine holds the only copy of the check, so one replacement suffices.
p = pathlib.Path('src/engine/physical.ts'); s = p.read_text()
old = '    if (repeated.length > 0) {'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '    if (false) {', 1)
p.write_text(s)
