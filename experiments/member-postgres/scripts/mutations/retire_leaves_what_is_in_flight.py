import pathlib
# §10.5. Leave an outstanding invitation and a half-finished ceremony behind,
# so either becomes a credential after the enrolment is undone.
p = pathlib.Path('device-acceptance.ts'); s = p.read_text()
old = ' const cancelled=r.enrollment.cancelEnrolment(value.principal);'
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, ' const cancelled=0;', 1)
p.write_text(s)
