import pathlib
# Clauses 9 and 39, second break beside result_form_on_party_ok, in the route.
# A result form sent with a party grant is dropped instead of being refused,
# so the request is accepted and the person is told nothing about the field
# they sent. A refusal by name is the point of the enum.
p = pathlib.Path("src/http.ts"); s = p.read_text()
old = '          result_form: raw.result_form === undefined ? undefined : requireString(raw, "result_form", "permission"),'
assert old in s, "the_route_drops_a_result_form: the anchor has drifted"
s = s.replace(old, '          result_form: raw.kind === "computation" && raw.result_form !== undefined ? requireString(raw, "result_form", "permission") : undefined,', 1)
p.write_text(s)
