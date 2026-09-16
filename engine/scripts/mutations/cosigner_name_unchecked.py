import pathlib
# §16.1, question 55. Let a co-signer be named by a free string again, so
# whoever registers that name first is the co-signer whose signature every
# loosening needs, which is what clause 47 rests on.
p = pathlib.Path('src/hub/mandates.ts'); s = p.read_text()
old = '      if (!isHouseholdName(k)) {\n'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, '      if (false) {\n', 1))
