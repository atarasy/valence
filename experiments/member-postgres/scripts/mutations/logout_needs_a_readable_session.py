import pathlib
# §13.2, question 55. Revoke only a session that resolves, so a principal
# that has not adopted a household cannot end its own session.
p = pathlib.Path('../member-login/transport.ts'); s = p.read_text()
old = '      deps.authority.endSession(token);'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, '      const session = await deps.authority.resolveSession(token);\n      if (session) deps.authority.revokeSession(session.id);', 1)
p.write_text(s)
