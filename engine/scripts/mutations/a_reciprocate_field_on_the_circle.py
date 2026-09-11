import pathlib
# Clause 18, second break beside nudge_route and deadline_on_receipt. No route
# is added and no deadline is set: the circle's rows carry an invitation to
# reciprocate, which is the prompt arriving as a field rather than as a push.
p = pathlib.Path("src/http.ts"); s = p.read_text()
old = '      return json({ edges: engine.circleFor(viewer) });'
assert old in s, "a_reciprocate_field_on_the_circle: the anchor has drifted"
s = s.replace(old, '      return json({ edges: engine.circleFor(viewer).map((e) => ({ ...e, reciprocate: true })) });', 1)
p.write_text(s)
