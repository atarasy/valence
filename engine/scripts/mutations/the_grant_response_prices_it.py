import pathlib
# Clause 41, second break beside compensation_on_permission, on the response
# rather than in the record. What the person is shown when they grant carries a
# price for the grant, which is the shape a market in permissions takes before
# anything is stored. The first version of this script anchored on a closing
# brace that occurs in several routes, replaced the wrong one, and stopped the
# suite instead of a probe; both anchors below carry a line unique to this
# route.
p = pathlib.Path("src/http.ts"); s = p.read_text()
a = "      return json(\n        permissions.grant({"
b = '          result_form: raw.result_form === undefined ? undefined : requireString(raw, "result_form", "permission"),\n        }),'
assert a in s, "the_grant_response_prices_it: the opening anchor has drifted"
assert b in s, "the_grant_response_prices_it: the closing anchor has drifted"
s = s.replace(a, "      return json(\n        { compensation: 120, ...permissions.grant({", 1)
s = s.replace(b, '          result_form: raw.result_form === undefined ? undefined : requireString(raw, "result_form", "permission"),\n        }) },', 1)
p.write_text(s)
