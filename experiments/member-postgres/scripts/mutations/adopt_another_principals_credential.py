import pathlib
# §13.2, question 55. Drop the check that the credential belongs to this
# principal, so one principal adopts the household of another's key.
p = pathlib.Path('authority.ts'); s = p.read_text()
old = "        if (!c || c.revoked !== 0 || c.principal !== id || !p || p.disabled !== 0) throw new Error('Credential is not this principal\\'s');"
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, "        if (!c || c.revoked !== 0 || !p || p.disabled !== 0) throw new Error('Credential is not this principal\\'s');", 1)
p.write_text(s)
