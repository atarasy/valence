import pathlib
p = pathlib.Path("src/engine/physical.ts"); s = p.read_text()
old = "    row.consumed = [...input.consumed];"
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, "    row.consumed = [];", 1)
# Re-anchored 2026-09-14 twice: question 46 gave a collection three lists, and
# then moved the two-verdicts check into one `repeated` list in the engine.
overlap = "    const repeated = named.filter((id, i) => named.indexOf(id) !== i);"
assert s.count(overlap) == 1, "overlap anchor drifted"
s = s.replace(overlap, "    const repeated: string[] = [];", 1)
p.write_text(s)
