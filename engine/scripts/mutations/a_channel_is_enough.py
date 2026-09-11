import pathlib
# Clause 53, second break beside recoverer_owns_every_channel. Ask only that
# some channel exists rather than that one is outside the recoverer's control,
# so a recoverer holding every channel is named and can recover in silence.
p = pathlib.Path("src/hub/node.ts"); s = p.read_text()
old = '    if (!channels.some((c) => !c.controlled_by_recoverer)) {\n      // A recoverer who holds every channel'
assert old in s, "a_channel_is_enough: the anchor has drifted"
s = s.replace(old, '    if (channels.length === 0) {\n      // A recoverer who holds every channel', 1)
p.write_text(s)
