import pathlib
# §16.1, question 56. Answer nothing to a household asking what it must sign,
# so a client that has been restored or reinstalled cannot reach the ceremony
# at all: no other route on this service names a claim.
p = pathlib.Path('mandate-ceremony.ts'); s = p.read_text()
old = "      return { mandates: r.engine.mandates.claimsFor(session.household) };\n"
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, "      return { mandates: [] };\n", 1))
