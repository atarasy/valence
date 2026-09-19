import pathlib
# §16.3, question 60. Read a hub that answers without `ceiling_daily` as one
# saying the giver set no ceiling, which charges a giver past the one it set.
p = pathlib.Path('src/engine/mandate-source.ts'); s = p.read_text()
old = '    const ceiling = (await this.household(household)).ceiling_daily;\n    if (ceiling !== null && !('
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '    const ceiling = (await this.household(household)).ceiling_daily;\n    if (ceiling === undefined) return null;\n    if (ceiling !== null && !(', 1)
p.write_text(s)
