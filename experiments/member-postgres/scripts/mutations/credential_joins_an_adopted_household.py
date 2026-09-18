import pathlib
# §13.2, question 55. Let a principal that has a household take a further
# credential, so a ceremony held open across the acceptance step reads it.
p = pathlib.Path('authority.ts'); s = p.read_text()
old = "        if (p.household !== null) throw new Error('This principal has a household and takes no further credential');\n"
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '', 1)
p.write_text(s)
