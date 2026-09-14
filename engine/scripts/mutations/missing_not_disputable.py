import pathlib
# §6.5, question 46 R1. Only a consumed line may be disputed, so a missing
# record is a claim the household cannot contest.
p = pathlib.Path('src/shared/statement.ts'); s = p.read_text()
old = '  return c !== undefined && (c.valence === "consumed" || (c.valence === "lost" && missing.includes(c.id)));'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '  return c !== undefined && c.valence === "consumed";', 1)
p.write_text(s)
