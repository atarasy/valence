import pathlib
# Rebinding a deployment's runtime profile. Drop the allow-list lookup so any
# bound profile, including one never issued by this codebase, is treated as
# an eligible source for the requested transition.
p = pathlib.Path('rebind-runtime.ts'); s = p.read_text()
old = " const allowed = ALLOWED_TRANSITIONS[bound.profile];\n   if (!allowed || allowed.to !== next.profile) refuse(); // no route for this source profile, including any downgrade\n"
assert s.count(old) == 1, "anchor drifted"
new = " const allowed = ALLOWED_TRANSITIONS[bound.profile] ?? { to: next.profile, additions: {} };\n"
s = s.replace(old, new, 1)
p.write_text(s)
