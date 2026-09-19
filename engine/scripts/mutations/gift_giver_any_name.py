import pathlib
# §13.2, question 58. Take any name as a gift's giver, so a presenter can
# register its own key under a name that is not one and sign as the giver.
p = pathlib.Path('src/engine/offers.ts'); s = p.read_text()
old = '      if (!isHouseholdName(input.giver)) {\n'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '      if (false) {\n', 1)
p.write_text(s)
