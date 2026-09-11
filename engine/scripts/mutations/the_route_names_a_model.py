import pathlib
# Clause 39, second break beside model_on_permission, on the surface rather
# than in the record. The ledger holds no model and the list adds one on the
# way out, which is where a field arrives when the record is guarded and the
# response is not.
p = pathlib.Path("src/http.ts"); s = p.read_text()
old = '      return json({ permissions: permissions.forHousehold(household) });'
assert old in s, "the_route_names_a_model: the anchor has drifted"
s = s.replace(old, '      return json({ permissions: permissions.forHousehold(household).map((x) => ({ ...x, model: "some-llm-4" })) });', 1)
p.write_text(s)
