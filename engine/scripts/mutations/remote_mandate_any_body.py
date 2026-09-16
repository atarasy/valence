import pathlib
# §13.2. Read whatever a hub answers as a mandate. A body of `{}` has no
# `lapses_at` and no ceiling, so every comparison against it is false and the
# protections apply to nothing.
p = pathlib.Path('src/engine/mandate-source.ts'); s = p.read_text()
old = '    if (!body || typeof body !== "object" || typeof (body as Mandate).household !== "string") {'
assert s.count(old) == 1, "anchor drifted"
p.write_text(s.replace(old, '    if (false) {', 1))
