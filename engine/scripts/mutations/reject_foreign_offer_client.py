import pathlib
# Clause 38: the endpoints answer alike whoever the caller is. Refuse an
# offer unless the user-agent is the reference hub's.
p = pathlib.Path("src/http.ts"); s = p.read_text()
old = '  if (parts[0] === "offers") {\n    if (method === "POST" && parts.length === 1) {'
assert s.count(old) == 1
new = '''  if (parts[0] === "offers") {
    if (method === "POST" && parts.length === 1) {
      if (!(request.headers.get("user-agent") ?? "").startsWith("atarasy-reference/")) {
        return json({ error: "forbidden", message: "offers are accepted from the reference hub only" }, 403);
      }'''
s = s.replace(old, new, 1)
p.write_text(s)
