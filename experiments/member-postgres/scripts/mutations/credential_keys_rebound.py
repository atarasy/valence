import pathlib
# §13.2, question 55. Let the credential-key reader be replaced after it is
# bound, so the household is named by whatever was bound last.
p = pathlib.Path('authority.ts'); s = p.read_text()
old = "      if (credentialKeys) throw new Error('Credential keys already bound');\n"
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '', 1)
p.write_text(s)
