import pathlib
# §10.5, question 55. Let a household be adopted from a credential that has
# never verified an assertion, so a key the client merely sent names a household.
p = pathlib.Path('authority.ts'); s = p.read_text()
old = "        if (c.proven !== 1) throw new Error('Credential has proven no key');\n"
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '', 1)
p.write_text(s)
