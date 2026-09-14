import pathlib
# §11.2, question 46. A note keyed to an item not named missing is accepted and
# dropped in silence. Re-anchored 2026-09-14 when the check moved from the HTTP
# route into RecoveryLedger.collect so an in-process caller meets it too.
p = pathlib.Path('src/engine/physical.ts'); s = p.read_text()
old = '    const stray = Object.keys(notes).filter((id) => !missing.includes(id));'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '    const stray: string[] = [];', 1)
p.write_text(s)
