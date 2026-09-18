import pathlib
# §16.2 and §14.2, question 56. Leave a claim out of what a household holds, so
# a move drops every protection instead of failing closed: the receiving host
# reads the household as one that has set nothing and leaves every offer alone.
p = pathlib.Path('src/hub/mandates.ts'); s = p.read_text()
old = '    return [...this.rows.values(), ...this.claims.values()].filter((m) => m.household === household);\n'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, '    return [...this.rows.values()].filter((m) => m.household === household);\n', 1))
