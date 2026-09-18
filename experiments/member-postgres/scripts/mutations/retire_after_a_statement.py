import pathlib
# §16.1. Let the enrolment be undone after a statement exists, so the key the
# household was adopted from is revoked under it.
p = pathlib.Path('device-acceptance.ts'); s = p.read_text()
old = " if(statementEntry(entries))throw new AcceptanceError('Statement acceptance already prepared; inspect status');\n const r=memberRuntime(store,c);\n const {proven,unproven}=r.authority.credentialProof(value.principal);"
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, ' const r=memberRuntime(store,c);\n const {proven,unproven}=r.authority.credentialProof(value.principal);', 1)
p.write_text(s)
