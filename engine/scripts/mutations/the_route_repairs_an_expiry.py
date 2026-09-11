import pathlib
# Clause 37, second break beside permission_never_expires, in the route. An
# expiry in the past or at zero is quietly moved a year out, so the ledger's
# refusal never fires and a permission the person meant to be brief becomes
# one that outlasts anything they would have agreed to.
p = pathlib.Path("src/http.ts"); s = p.read_text()
old = '          expires_at: requireInteger(raw, "expires_at", "permission", 0),'
assert old in s, "the_route_repairs_an_expiry: the anchor has drifted"
s = s.replace(old, '          expires_at: Math.max(requireInteger(raw, "expires_at", "permission", 0), Date.now() + 31_536_000_000),', 1)
p.write_text(s)
