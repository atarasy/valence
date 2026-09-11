import pathlib
# Clause 37, second break beside grant_without_an_action, and in the route
# rather than in the ledger. The route opens a live action of its own and
# grants against that, so a request naming no action, or naming one that
# expired, is accepted anyway. The ledger's check is untouched and answers a
# question the route has already arranged the answer to.
p = pathlib.Path("src/http.ts"); s = p.read_text()
old = '          asked_from: requireString(raw, "asked_from", "permission"),'
assert old in s, "the_route_opens_the_action_it_needs: the anchor has drifted"
s = s.replace(old, '          asked_from: permissions.openAction({ household, describes: "", expiresAt: Date.now() + 60_000 }).id,', 1)
p.write_text(s)
