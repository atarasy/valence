import pathlib
# Clause 38, second break beside own_agent_is_a_grantee, in the route. A
# grantee equal to the household is renamed rather than refused, so the
# person's own agent enters the ledger under another name and the row that
# could be revoked is the one the hub depends on.
p = pathlib.Path("src/http.ts"); s = p.read_text()
old = '          grantee: requireString(raw, "grantee", "permission"),'
assert old in s, "the_route_renames_the_household: the anchor has drifted"
s = s.replace(old, '          grantee: requireString(raw, "grantee", "permission") === household ? household + "-agent" : requireString(raw, "grantee", "permission"),', 1)
p.write_text(s)
