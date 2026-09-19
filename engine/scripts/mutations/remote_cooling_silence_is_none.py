import pathlib
# §16.5, question 68. Read a hub that answers without `cooling_seconds` as one
# saying the household set no window, which settles a set it could take back.
p = pathlib.Path('src/engine/mandate-source.ts'); s = p.read_text()
old = """    const cooling = (await this.household(household)).cooling_seconds;
    if (!readableNonNegative(cooling)) {"""
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, """    const cooling = (await this.household(household)).cooling_seconds;
    if (cooling === undefined) return null;
    if (!readableNonNegative(cooling)) {""", 1)
p.write_text(s)
