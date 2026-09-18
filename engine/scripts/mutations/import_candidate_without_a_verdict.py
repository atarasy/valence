import pathlib
# §14.2, question 57. Take a candidate that arrives with no verdict. `decide`
# reads a valence that is not `offered` as one already decided, so such a
# candidate can never be decided and its line settles at nothing.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '      if (typeof c.valence !== "string" || !c.valence) {\n'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, '      if (false) {\n', 1))
