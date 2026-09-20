import pathlib
# §16.2, question 68. Read a hub that answers without `ceiling_out_of_network`
# as one saying the household set none, which presents an offer past the
# ceiling it set on another of its labels.
p = pathlib.Path('src/engine/mandate-source.ts'); s = p.read_text()
old = """    const ceiling = (await this.household(household)).ceiling_out_of_network;
    if (!readableNonNegative(ceiling)) {"""
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, """    const ceiling = (await this.household(household)).ceiling_out_of_network;
    if (ceiling === undefined) return null;
    if (!readableNonNegative(ceiling)) {""", 1)
p.write_text(s)
