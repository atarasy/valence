import pathlib
# §13.2, question 55. Let `provisionPrincipal` write a household that is the
# name of a key, so a name nobody proved is claimed by whoever writes it first.
p = pathlib.Path('authority.ts'); s = p.read_text()
old = "      if (isHouseholdName(household)) throw new Error('A household that is a key is adopted, not assigned');\n"
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '', 1)
p.write_text(s)
