import pathlib
# §16.5, question 68. Take the shortest window among a household's mandates
# instead of the longest. The tightest window is the longest one, and this is
# the one place in §16 where the tighter value is the larger.
p = pathlib.Path('src/engine/mandate-source.ts'); s = p.read_text()
old = "    if (longest === null || m.cooling_seconds > longest) longest = m.cooling_seconds;"
assert s.count(old) == 1, "anchor drifted"
s = s.replace(old, "    if (longest === null || m.cooling_seconds < longest) longest = m.cooling_seconds;", 1)
p.write_text(s)
