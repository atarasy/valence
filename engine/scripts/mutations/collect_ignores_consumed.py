import pathlib
p = pathlib.Path("src/engine/physical.ts"); s = p.read_text()
old = "    row.consumed = [...input.consumed];"
assert old in s, "anchor drifted"
s = s.replace(old, "    row.consumed = [];", 1)
# Re-anchored 2026-09-14 after question 46 gave a collection three lists; the
# previous anchor had stopped matching, so this half silently did nothing.
overlap = "    const both = lists.flatMap((list, i) => list.filter((id) => lists.some((other, j) => j !== i && other.includes(id))));"
assert overlap in s, "overlap anchor drifted"
s = s.replace(overlap, "    const both: string[] = [];", 1)
p.write_text(s)
