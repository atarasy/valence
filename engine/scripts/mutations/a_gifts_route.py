import pathlib
# Clause 20, second break beside received_route. A route named for gifts rather
# than for receipts, enumerating what a household has been given. The clause is
# about the capability and not about the word, and this is the word somebody
# reaches for second.
p = pathlib.Path("src/http.ts"); s = p.read_text()
old = '  if (parts[0] === "households" && parts[1] && parts[2] === "queries" && method === "GET") {'
assert old in s, "a_gifts_route: the anchor has drifted"
new = (
    '  if (parts[0] === "households" && parts[1] && parts[2] === "gifts" && method === "GET") {\n'
    '    return json({ gifts: [] });\n'
    '  }\n\n' + old
)
s = s.replace(old, new, 1)
p.write_text(s)
