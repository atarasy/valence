import pathlib
# Section 17.2, second break beside registry_echoes_caller. The list names who
# asked, on the response rather than on each entry. The same answer to every
# caller is the property, and a field that varies by caller breaks it wherever
# it sits.
p = pathlib.Path("src/http.ts"); s = p.read_text()
old = '      return json({\n        entries: registry.list({'
assert old in s, "registry_answers_with_the_caller: the anchor has drifted"
s = s.replace(old, '      return json({\n        asked_by: request.headers.get("user-agent") ?? "unknown",\n        entries: registry.list({', 1)
p.write_text(s)
