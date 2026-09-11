import pathlib
# Section 9.1 and clause 1, second break beside routes_all_registered, which
# carries thirteen probes on one anchor. This one leaves every handler alone
# and turns the router's own default from a refusal into an empty success, so
# a forbidden route answers 200 without anybody registering it. A default that
# says yes is how a route nobody wrote comes to exist.
p = pathlib.Path("src/http.ts"); s = p.read_text()
old = '    { error: "no_such_route", message: `${method} ${path} is not a route` },\n    404'
assert old in s, "unknown_route_answers_200: the anchor has drifted"
s = s.replace(old, '    { error: "no_such_route", message: `${method} ${path} is not a route` },\n    200', 1)
p.write_text(s)
