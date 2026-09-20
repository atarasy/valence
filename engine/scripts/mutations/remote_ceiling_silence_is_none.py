import pathlib
# §16.3, question 60. Read a hub that answers without `ceiling_daily` as one
# saying the giver set no ceiling, which charges a giver past the one it set.
# Re-anchored when question 68 was rebased onto questions 65 to 67: the three
# remote reads share one shape check, `readableNonNegative`.
p = pathlib.Path('src/engine/mandate-source.ts'); s = p.read_text()
old = """    const ceiling = (await this.household(household)).ceiling_daily;
    if (!readableNonNegative(ceiling)) {"""
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, """    const ceiling = (await this.household(household)).ceiling_daily;
    if (ceiling === undefined) return null;
    if (!readableNonNegative(ceiling)) {""", 1)
p.write_text(s)
