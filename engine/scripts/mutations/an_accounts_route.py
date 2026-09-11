import pathlib
# Clause 2, second break beside signup_route. A route under accounts rather
# than under signup, minting and returning an identifier. Nothing here issues
# an identity, and the clause is about the issuing and not about the word on
# the door.
p = pathlib.Path("src/http.ts"); s = p.read_text()
old = '  if (parts[0] === "lineage") {'
assert old in s, "an_accounts_route: the anchor has drifted"
s = s.replace(old, '  if (parts[0] === "accounts" && method === "POST") {\n    return json({ id: `household-${Math.random().toString(36).slice(2)}` }, 201);\n  }\n\n  if (parts[0] === "lineage") {', 1)
p.write_text(s)
