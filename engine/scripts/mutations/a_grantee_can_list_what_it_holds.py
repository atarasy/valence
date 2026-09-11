import pathlib
# Clauses 39 and 41, second break beside global_permissions_route. A route
# under the grantee rather than the household, which is the same capability
# arriving from the other end: whoever holds grants can enumerate them, and a
# ledger that answers to a grantee is a ledger the person does not own.
p = pathlib.Path("src/http.ts"); s = p.read_text()
old = "  // §4.2. Who asked what, in the recipient's own record."
assert old in s, "a_grantee_can_list_what_it_holds: the anchor has drifted"
s = s.replace(old, '  if (parts[0] === "grantees" && parts[1] && parts[2] === "permissions" && method === "GET") {\n    return json({ permissions: [] });\n  }\n\n  // §4.2. Who asked what, in the recipient\'s own record.', 1)
p.write_text(s)
